// ═══════════════════════════════════════════════════════════════════════════
// CREATE ENDORSEMENT USE CASE — Caso de Uso Principal
//
// Orquesta el flujo completo de emisión de un endoso:
//   1. Consultar póliza (via IPolicyPort)
//   2. Cargar configuración del tenant (TenantConfig)
//   3. Evaluar reglas de elegibilidad (RuleEngineService)
//   4. Calcular costo del endoso (CalculationEngineService)
//   5. Persistir en transacción atómica (EndorsementRepository)
//   6. Registrar auditoría (EndorsementAudit)
//
// PRINCIPIO SOLID — Single Responsibility:
//   Este caso de uso SOLO orquesta. No contiene lógica de negocio propia.
//   La lógica vive en los servicios de dominio y en la entidad Endorsement.
// ═══════════════════════════════════════════════════════════════════════════

import { Injectable, Inject, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { CreateEndorsementDto } from '../dtos/create-endorsement.dto';
import { Endorsement, EndorsementStatus } from '../../domain/entities/endorsement.entity';
import type { EndorsementCalculation } from '../../domain/entities/endorsement.entity';
import { RuleEngineService } from '../../domain/services/rule-engine.service';
import { CalculationEngineService } from '../../domain/services/calculation-engine.service';
import type { IPolicyPort } from '../../domain/ports/policy.port';
import { POLICY_PORT_TOKEN } from '../../domain/ports/policy.port';
import type { IEndorsementRepository } from '../../domain/ports/endorsement-repository.port';
import { ENDORSEMENT_REPOSITORY_TOKEN } from '../../domain/ports/endorsement-repository.port';
import { TenantConfigRepository } from '../../infrastructure/repositories/tenant-config.repository';
import { PrismaService } from '../../infrastructure/database/prisma.service';

/**
 * @class CreateEndorsementUseCase
 * @description Caso de uso para crear y emitir (o enviar a aprobación) un endoso.
 *
 * La transacción de base de datos garantiza que si algo falla en algún paso
 * (ej: al registrar la auditoría), TODA la operación se revierte.
 * El usuario nunca verá un endoso "a medias" en la base de datos.
 */
@Injectable()
export class CreateEndorsementUseCase {
  private readonly logger = new Logger(CreateEndorsementUseCase.name);

  constructor(
    @Inject(POLICY_PORT_TOKEN)
    private readonly policyPort: IPolicyPort,
    @Inject(ENDORSEMENT_REPOSITORY_TOKEN)
    private readonly endorsementRepo: IEndorsementRepository,
    private readonly tenantConfigRepo: TenantConfigRepository,
    private readonly ruleEngine: RuleEngineService,
    private readonly calculationEngine: CalculationEngineService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(tenantId: string, dto: CreateEndorsementDto): Promise<Endorsement> {
    this.logger.log(`Creating endorsement for tenant=${tenantId}, policy=${dto.policyId}`);

    // ─── 1. Consultar póliza al Core ──────────────────────────────────────
    const policy = await this.policyPort.findByPolicyId(tenantId, dto.policyId);
    if (!policy) {
      throw new NotFoundException(`Póliza "${dto.policyId}" no encontrada`);
    }

    if (policy.status !== 'active') {
      throw new BadRequestException(
        `La póliza "${dto.policyId}" no está activa. Estado: ${policy.status}`
      );
    }

    // ─── 2. Cargar configuración del tenant ───────────────────────────────
    const tenantConfig = await this.tenantConfigRepo.getByTenantId(tenantId);

    // Buscar el tipo de endoso en la configuración
    const endorsementType = (tenantConfig.endorsementTypes as any[]).find(
      (t: any) => t.id === dto.endorsementTypeId,
    );
    if (!endorsementType) {
      throw new BadRequestException(
        `Tipo de endoso "${dto.endorsementTypeId}" no configurado para este tenant`
      );
    }

    // Buscar el canal
    const channel = (tenantConfig.channels as any[]).find(
      (c: any) => c.id === dto.channelId,
    );
    if (!channel) {
      throw new BadRequestException(
        `Canal "${dto.channelId}" no configurado para este tenant`
      );
    }

    // Buscar el producto de la póliza
    const allProducts = (tenantConfig.branches as any[]).flatMap(
      (b: any) => b.products ?? [],
    );
    const product = allProducts.find((p: any) => p.id === policy.productId);

    // ─── 3. Evaluar reglas de elegibilidad ────────────────────────────────
    const rules = product?.rules ?? [];
    const availability = this.ruleEngine.checkEndorsementAvailability(
      endorsementType,
      rules,
      policy,
      channel,
    );

    if (availability.status === 'blocked') {
      const reasons = availability.blockingRules.map((r) => r.message).join('; ');
      throw new BadRequestException(`Endoso bloqueado por reglas: ${reasons}`);
    }

    if (availability.status === 'channel-disabled') {
      throw new BadRequestException(
        `El canal "${dto.channelId}" no permite este tipo de endoso`
      );
    }

    const appliedRuleIds = [...availability.blockingRules, ...availability.warningRules]
      .map((r) => r.ruleId);

    // ─── 4. Calcular costo (para endosos cuantitativos con ruta) ─────────
  let calculation: EndorsementCalculation | undefined;
  let requiresPayment = endorsementType.requiresPayment;

    if (dto.routeId && product?.tariff) {
      let route = (product.endorsementRoutes ?? []).find(
        (r: any) => r.id === dto.routeId,
      );

      if (!route && dto.routeId.startsWith('dynamic-route-')) {
        const targetPlanCode = dto.routeId.replace('dynamic-route-', '');
        route = {
          id: dto.routeId,
          endorsementTypeId: 'ampliacion-plan',
          sourcePlanCode: policy.planCode,
          sourcePlanLabel: policy.planLabel,
          targetPlanCode,
          targetPlanLabel: targetPlanCode,
          allowedChannels: ['backoffice'],
          prorateMethod: 'days-remaining',
          taxRules: []
        };
      }

      if (!route) {
        throw new BadRequestException(
          `Ruta de endoso "${dto.routeId}" no encontrada en el producto`
        );
      }

      let targetPremium = dto.targetPremium;

      if (targetPremium === undefined || targetPremium === null) {
        targetPremium = this.calculationEngine.getPremiumFromTariff(
          product.tariff,
          route.targetPlanCode,
          policy.segmentCode,
        );

        const externalPremium = await this.calculationEngine.getExternalAutoPremium(
          policy,
          route.targetPlanCode,
        );
        if (externalPremium !== null) {
          targetPremium = externalPremium;
        }
      }

      if (targetPremium === 0 && dto.routeId.startsWith('dynamic-route-')) {
        targetPremium = policy.annualPremium + 100;
      }

      const calcResult = this.calculationEngine.calculateEndorsement(
        route,
        policy,
        targetPremium,
      );

      calculation = {
        sourcePlan: policy.planCode,
        targetPlan: route.targetPlanCode,
        currentPremium: calcResult.currentPremium,
        targetPremium: calcResult.targetPremium,
        annualDifference: calcResult.annualDifference,
        daysRemaining: calcResult.daysRemaining,
        prorateMethod: calcResult.prorateMethod,
        proratedAmount: calcResult.proratedAmount,
        taxes: calcResult.taxes,
        adminFee: calcResult.adminFee,
        totalCharge: calcResult.totalCharge,
        formula: calcResult.formula,
      } as EndorsementCalculation;

      requiresPayment = calculation.totalCharge > 0 && endorsementType.requiresPayment;
    }

    // ─── 5. Persistir en transacción atómica ─────────────────────────────
    const endorsement = await this.prisma.withTransaction(async (tx) => {
      // 5a. Crear la entidad de dominio
      const newEndorsement = new Endorsement({
        id: randomUUID(),
        tenantId,
        policyId: dto.policyId,
        endorsementTypeId: dto.endorsementTypeId,
        routeId: dto.routeId ?? null,
        channelId: dto.channelId,
        effectiveDate: new Date(dto.effectiveDate),
        status: EndorsementStatus.DRAFT,
        workflowStep: null,
        calculation: calculation,
        formData: dto.formData ?? null,
        appliedRules: appliedRuleIds,
        endorsementNumber: null,
        rejectionReason: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        emittedAt: null,
      });

      // 5b. Aplicar transición de estado según el resultado de reglas
      if (availability.status === 'requires-approval') {
        const workflow = (tenantConfig.workflows as any[]).find(
          (w: any) => w.id === endorsementType.approvalWorkflowId,
        );
        const firstStep = workflow?.steps?.[0];
        newEndorsement.sendToApproval(
          firstStep?.name ?? 'Supervisor Review',
          calculation,
        );
      } else if (requiresPayment && calculation) {
        newEndorsement.markAsPendingPayment(calculation);
      } else {
        // Emitir directamente (sin pago ni aprobación requerida)
        const endorsementNumber = await this.endorsementRepo.generateEndorsementNumber(
          tenantId,
          tx,
        );
        newEndorsement.emit(endorsementNumber);
      }

      // 5c. Persistir el endoso
      const saved = await this.endorsementRepo.save(newEndorsement, tx);

      // 5d. Registrar entrada de auditoría
      await (tx as any).endorsementAudit.create({
        data: {
          endorsementId: saved.id,
          tenantId,
          event: 'ENDORSEMENT_CREATED',
          user: 'system', // En el futuro: extraer del JWT
          data: {
            status: saved.status,
            policyId: dto.policyId,
            endorsementTypeId: dto.endorsementTypeId,
            calculation: calculation,
            appliedRules: appliedRuleIds,
            availability: availability.status,
          },
        },
      });

      return saved;
    });

    this.logger.log(
      `Endorsement created: id=${endorsement.id}, status=${endorsement.status}`
    );

    return endorsement;
  }
}
