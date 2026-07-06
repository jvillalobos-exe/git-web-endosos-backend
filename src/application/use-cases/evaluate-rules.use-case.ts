// ═══════════════════════════════════════════════════════════════════════════
// EVALUATE RULES USE CASE — Pre-evaluación de Reglas
// Permite al cliente verificar elegibilidad ANTES de emitir el endoso.
// Usado en el wizard: Paso "Catálogo" para mostrar disponibilidad por tipo.
// ═══════════════════════════════════════════════════════════════════════════

import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import type { IPolicyPort } from '../../domain/ports/policy.port';
import { POLICY_PORT_TOKEN } from '../../domain/ports/policy.port';
import { RuleEngineService, EndorsementAvailability } from '../../domain/services/rule-engine.service';
import { TenantConfigRepository } from '../../infrastructure/repositories/tenant-config.repository';

export interface EvaluateRulesResult {
  policyId: string;
  channelId: string;
  availabilities: EndorsementAvailability[];
}

@Injectable()
export class EvaluateRulesUseCase {
  constructor(
    @Inject(POLICY_PORT_TOKEN)
    private readonly policyPort: IPolicyPort,
    private readonly tenantConfigRepo: TenantConfigRepository,
    private readonly ruleEngine: RuleEngineService,
  ) {}

  async execute(
    tenantId: string,
    policyId: string,
    channelId: string,
  ): Promise<EvaluateRulesResult> {
    // 1. Consultar póliza
    const policy = await this.policyPort.findByPolicyId(tenantId, policyId);
    if (!policy) {
      throw new NotFoundException(`Póliza "${policyId}" no encontrada`);
    }

    // 2. Cargar configuración del tenant
    const tenantConfig = await this.tenantConfigRepo.getByTenantId(tenantId);

    // 3. Encontrar el canal
    const channel = (tenantConfig.channels as any[]).find(
      (c: any) => c.id === channelId,
    );
    if (!channel) {
      throw new NotFoundException(`Canal "${channelId}" no configurado`);
    }

    // 4. Obtener reglas del producto
    const allProducts = (tenantConfig.branches as any[]).flatMap(
      (b: any) => b.products ?? [],
    );
    const product = allProducts.find((p: any) => p.id === policy.productId);
    const rules = product?.rules ?? [];

    // 5. Evaluar disponibilidad por tipo de endoso
    const availabilities = (tenantConfig.endorsementTypes as any[]).map(
      (endorsementType: any) =>
        this.ruleEngine.checkEndorsementAvailability(
          endorsementType,
          rules,
          policy,
          channel,
        ),
    );

    return { policyId, channelId, availabilities };
  }
}
