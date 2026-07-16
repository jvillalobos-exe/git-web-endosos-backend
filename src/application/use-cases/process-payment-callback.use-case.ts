import {
  Injectable,
  Inject,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { ENDORSEMENT_REPOSITORY_TOKEN } from '../../domain/ports/endorsement-repository.port';
import type { IEndorsementRepository } from '../../domain/ports/endorsement-repository.port';
import { Endorsement } from '../../domain/entities/endorsement.entity';
import { POLICY_PORT_TOKEN } from '../../domain/ports/policy.port';
import type { IPolicyPort } from '../../domain/ports/policy.port';
import { CoreIntegrationService } from '../../infrastructure/adapters/core-integration.service';

@Injectable()
export class ProcessPaymentCallbackUseCase {
  private readonly logger = new Logger(ProcessPaymentCallbackUseCase.name);

  constructor(
    @Inject(ENDORSEMENT_REPOSITORY_TOKEN)
    private readonly endorsementRepo: IEndorsementRepository,
    private readonly prisma: PrismaService,
    @Inject(POLICY_PORT_TOKEN)
    private readonly policyPort: IPolicyPort,
    private readonly coreIntegration: CoreIntegrationService,
  ) {}

  async execute(payload: {
    policyId: string;
    isSuccess: boolean;
    reference: string;
    message?: string;
  }): Promise<{ success: boolean; message: string; status?: string }> {
    const { policyId, isSuccess, reference, message } = payload;

    this.logger.log(
      `Processing payment callback for policyId=${policyId}, isSuccess=${isSuccess}, reference=${reference}`,
    );

    // 1. Buscar endoso en PENDING_PAYMENT asociado a la póliza
    const record = await this.prisma.endorsement.findFirst({
      where: {
        policyId: policyId,
        status: 'PENDING_PAYMENT',
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (!record) {
      this.logger.warn(
        `No pending payment endorsement found for policy ${policyId}`,
      );
      return {
        success: false,
        message: 'No se encontró endoso pendiente de pago para esta póliza.',
      };
    }

    // Mapear a entidad de dominio
    const endorsement = new Endorsement({
      id: record.id,
      tenantId: record.tenantId,
      policyId: record.policyId,
      endorsementTypeId: record.endorsementTypeId,
      routeId: record.routeId,
      channelId: record.channelId,
      effectiveDate: record.effectiveDate,
      status: record.status as any,
      workflowStep: record.workflowStep,
      calculation: record.calculation as any,
      formData: record.formData as any,
      appliedRules: record.appliedRules,
      endorsementNumber: record.endorsementNumber,
      rejectionReason: record.rejectionReason,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      emittedAt: record.emittedAt,
    });

    if (!isSuccess) {
      this.logger.warn(
        `Payment failed for endorsement ${endorsement.id}: ${message}`,
      );
      // Mantenemos el estado en PENDING_PAYMENT para permitir reintento de pago
      return {
        success: true,
        status: 'failed',
        message: 'Se registró el fallo de pago para reintento.',
      };
    }

    // 2. Realizar la integración con el Core (anular recibos previos y crear nuevo recibo de endoso en el Core)
    const calc = endorsement.calculation as any;
    let coreReceipt: { cnrecibo: string; crecibo: number } | undefined =
      undefined;

    if (calc && endorsement.routeId) {
      try {
        const policy = await this.policyPort.findByPolicyId(
          endorsement.tenantId,
          endorsement.policyId,
        );
        if (!policy) {
          throw new BadRequestException(
            `Póliza "${endorsement.policyId}" no encontrada al procesar el pago.`,
          );
        }

        const effectiveDate = endorsement.effectiveDate
          .toISOString()
          .split('T')[0];
        const integrationResult =
          await this.coreIntegration.processCoreIntegration(
            policy,
            calc,
            effectiveDate,
          );

        if (integrationResult) {
          coreReceipt = integrationResult;
          endorsement.setCoreReceipt(coreReceipt.cnrecibo, coreReceipt.crecibo);
        }
      } catch (err: any) {
        this.logger.error(
          `Error during Core integration on payment callback: ${err.message}`,
        );
        throw err;
      }
    }

    // 3. Transición del endoso local a EMITTED
    // Generar el próximo número de endoso
    const endorsementNumber =
      await this.endorsementRepo.generateEndorsementNumber(
        endorsement.tenantId,
      );

    endorsement.completePayment(endorsementNumber);
    await this.endorsementRepo.update(endorsement);

    // Registrar auditoría del pago y emisión
    await this.prisma.endorsementAudit.create({
      data: {
        endorsementId: endorsement.id,
        tenantId: endorsement.tenantId,
        event: 'ENDORSEMENT_PAID_AND_EMITTED',
        user: 'system',
        data: {
          status: endorsement.status,
          reference: reference,
          endorsementNumber: endorsementNumber,
          cnrecibo: coreReceipt?.cnrecibo,
        },
      },
    });

    // 4. Notificar cobro al Core de La Mundial (SysIP-backend)
    const finalCnrecibo = coreReceipt?.cnrecibo || calc?.cnrecibo;
    const totalCharge = calc?.totalCharge || 0;

    if (!finalCnrecibo) {
      this.logger.warn(
        `Endorsement ${endorsement.id} emitted but has no cnrecibo to report to Core.`,
      );
      return {
        success: true,
        status: 'success',
        message:
          'Endoso emitido con éxito localmente, pero sin recibo contable asociado.',
      };
    }

    await this.coreIntegration.reportPayment({
      cnrecibo: finalCnrecibo,
      totalCharge,
      reference,
    });

    return {
      success: true,
      status: 'success',
      message: 'Endoso emitido y cobro reportado al Core exitosamente.',
    };
  }
}
