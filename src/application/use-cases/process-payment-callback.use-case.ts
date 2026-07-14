import { Injectable, Inject, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { ENDORSEMENT_REPOSITORY_TOKEN } from '../../domain/ports/endorsement-repository.port';
import type { IEndorsementRepository } from '../../domain/ports/endorsement-repository.port';
import { Endorsement } from '../../domain/entities/endorsement.entity';

@Injectable()
export class ProcessPaymentCallbackUseCase {
  private readonly logger = new Logger(ProcessPaymentCallbackUseCase.name);

  constructor(
    @Inject(ENDORSEMENT_REPOSITORY_TOKEN)
    private readonly endorsementRepo: IEndorsementRepository,
    private readonly prisma: PrismaService,
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
      this.logger.warn(`No pending payment endorsement found for policy ${policyId}`);
      return { success: false, message: 'No se encontró endoso pendiente de pago para esta póliza.' };
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
      this.logger.warn(`Payment failed for endorsement ${endorsement.id}: ${message}`);
      // Mantenemos el estado en PENDING_PAYMENT para permitir reintento de pago
      return { success: true, status: 'failed', message: 'Se registró el fallo de pago para reintento.' };
    }

    // 2. Transición del endoso local a EMITTED
    // Generar el próximo número de endoso
    const endorsementNumber = await this.endorsementRepo.generateEndorsementNumber(
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
        },
      },
    });

    // 3. Obtener el número de recibo (cnrecibo) guardado en el endoso
    const calc = endorsement.calculation as any;
    const cnrecibo = calc?.cnrecibo;
    const totalCharge = calc?.totalCharge || 0;

    if (!cnrecibo) {
      this.logger.warn(
        `Endorsement ${endorsement.id} emitted but has no cnrecibo in calculation to report to Core.`,
      );
      return {
        success: true,
        status: 'success',
        message: 'Endoso emitido con éxito localmente, pero sin recibo contable asociado.',
      };
    }

    // 4. Notificar cobro al Core de La Mundial (SysIP-backend)
    const CORE_API_BASE_URL =
      process.env.CORE_API_URL ?? 'https://qaapisys2000.lamundialdeseguros.com';
    const CORE_API_KEY =
      process.env.CORE_API_KEY ??
      '46fce2c9f33e09ed3404fca58592d3000d20d419dabb7cd456e958818ff07de9';

    this.logger.log(
      `Reporting payment of receipt ${cnrecibo} to Core collection API...`,
    );

    try {
      const response = await fetch(
        `${CORE_API_BASE_URL}/api/v1/external/collection/collect`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'api-key': CORE_API_KEY,
          },
          body: JSON.stringify({
            cnrecibo: cnrecibo,
            mpago: totalCharge,
            xreferencia: reference,
            fpago: new Date().toISOString().split('T')[0],
          }),
        },
      );

      if (!response.ok) {
        const errText = await response.text();
        this.logger.error(
          `Core collection API returned error status ${response.status}: ${errText}`,
        );
      } else {
        this.logger.log(`Payment reported successfully to Core for receipt ${cnrecibo}`);
      }
    } catch (err: any) {
      this.logger.error(`Failed to call Core collection API: ${err.message}`);
    }

    return {
      success: true,
      status: 'success',
      message: 'Endoso emitido y cobro reportado al Core exitosamente.',
    };
  }
}
