// ═══════════════════════════════════════════════════════════════════════════
// QUERY POLICY USE CASE — Consulta de Póliza
// ═══════════════════════════════════════════════════════════════════════════

import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import type { IPolicyPort, PolicySnapshot, PolicySearchFilters } from '../../domain/ports/policy.port';
import { POLICY_PORT_TOKEN } from '../../domain/ports/policy.port';

@Injectable()
export class QueryPolicyUseCase {
  constructor(
    @Inject(POLICY_PORT_TOKEN)
    private readonly policyPort: IPolicyPort,
  ) {}

  async findById(tenantId: string, policyId: string): Promise<PolicySnapshot> {
    const policy = await this.policyPort.findByPolicyId(tenantId, policyId);
    if (!policy) {
      throw new NotFoundException(`Póliza "${policyId}" no encontrada`);
    }
    return policy;
  }

  async findMany(tenantId: string, filters?: PolicySearchFilters): Promise<PolicySnapshot[]> {
    return this.policyPort.findMany(tenantId, filters);
  }

  async getPlanes(filters: any): Promise<any> {
    return this.policyPort.getPlanes(filters);
  }
}
