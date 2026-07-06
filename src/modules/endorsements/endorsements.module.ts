// ═══════════════════════════════════════════════════════════════════════════
// ENDORSEMENTS MODULE — Wiring de Dependencias
// Registra todos los providers usando tokens de inyección para desacoplar
// la interfaz (puerto) de la implementación (adaptador/repositorio).
// ═══════════════════════════════════════════════════════════════════════════

import { Module } from '@nestjs/common';
import { EndorsementsController } from './endorsements.controller';
import { PoliciesController } from '../policies/policies.controller';
import { CreateEndorsementUseCase } from '../../application/use-cases/create-endorsement.use-case';
import { EvaluateRulesUseCase } from '../../application/use-cases/evaluate-rules.use-case';
import { QueryPolicyUseCase } from '../../application/use-cases/query-policy.use-case';
import { RuleEngineService } from '../../domain/services/rule-engine.service';
import { CalculationEngineService } from '../../domain/services/calculation-engine.service';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { EndorsementRepository } from '../../infrastructure/repositories/endorsement.repository';
import { TenantConfigRepository } from '../../infrastructure/repositories/tenant-config.repository';
import { MockPolicyAdapter } from '../../infrastructure/adapters/mock-policy.adapter';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { POLICY_PORT_TOKEN } from '../../domain/ports/policy.port';
import { ENDORSEMENT_REPOSITORY_TOKEN } from '../../domain/ports/endorsement-repository.port';

@Module({
  controllers: [EndorsementsController, PoliciesController],
  providers: [
    // ─── Infraestructura ────────────────────────────────────────────────
    PrismaService,
    TenantGuard,
    TenantConfigRepository,

    // ─── Repositorio (implementa el puerto) ─────────────────────────────
    // Para cambiar la implementación de persistencia, solo cambiar aquí.
    {
      provide: ENDORSEMENT_REPOSITORY_TOKEN,
      useClass: EndorsementRepository,
    },

    // ─── Adaptador de Pólizas (implementa el puerto IPolicyPort) ─────────
    // Para conectar el Core real de una aseguradora:
    //   1. Crear MyInsurerPolicyAdapter implements IPolicyPort
    //   2. Cambiar useClass: MockPolicyAdapter → useClass: MyInsurerPolicyAdapter
    // O usar useFactory para resolución dinámica por tenant.
    {
      provide: POLICY_PORT_TOKEN,
      useClass: MockPolicyAdapter,
    },

    // ─── Servicios de Dominio ────────────────────────────────────────────
    RuleEngineService,
    CalculationEngineService,

    // ─── Casos de Uso ────────────────────────────────────────────────────
    CreateEndorsementUseCase,
    EvaluateRulesUseCase,
    QueryPolicyUseCase,
  ],
  exports: [PrismaService, TenantConfigRepository],
})
export class EndorsementsModule {}
