// ═══════════════════════════════════════════════════════════════════════════
// MOCK POLICY ADAPTER — Implementación del Puerto de Pólizas
//
// Este adaptador implementa IPolicyPort usando datos de demo.
// Es el equivalente de los `demoPortfolios` del seedData.ts del frontend.
//
// Propósito: Permitir que el sistema funcione sin un Core externo real,
// facilitando demos, desarrollo y testing.
//
// Para conectar un Core real, crear un nuevo adaptador que implemente
// IPolicyPort y reemplazar este en el módulo de NestJS.
// ═══════════════════════════════════════════════════════════════════════════

import { Injectable } from '@nestjs/common';
import type { IPolicyPort, PolicySnapshot, PolicySearchFilters } from '../../domain/ports/policy.port';

/**
 * Portfolio de pólizas demo para la aseguradora "La Mundial de Seguros".
 * Estos datos corresponden exactamente a los demoPortfolios del seedData.ts.
 */
const DEMO_PORTFOLIOS: PolicySnapshot[] = [
  {
    policyId: 'POL-001',
    insuredName: 'María García Rodríguez',
    productId: 'rcv-basic',
    productName: 'RCV Básico',
    branchCode: 'AUTO',
    planCode: 'BASIC',
    planLabel: 'Plan Básico',
    segmentCode: 'A',
    segmentLabel: 'Segmento A',
    sumInsured: 10000,
    startDate: '2024-01-15',
    endDate: '2025-01-14',
    daysRemaining: 180,
    annualPremium: 450,
    status: 'active',
    debtDays: 0,
    openClaims: 0,
    currency: 'USD',
    channel: 'backoffice',
  },
  {
    policyId: 'POL-002',
    insuredName: 'Carlos Mendoza Pérez',
    productId: 'rcv-basic',
    productName: 'RCV Básico',
    branchCode: 'AUTO',
    planCode: 'BASIC',
    planLabel: 'Plan Básico',
    segmentCode: 'B',
    segmentLabel: 'Segmento B',
    sumInsured: 15000,
    startDate: '2024-03-01',
    endDate: '2025-02-28',
    daysRemaining: 240,
    annualPremium: 520,
    status: 'active',
    debtDays: 15,
    openClaims: 1,
    currency: 'USD',
    channel: 'agencia',
  },
  {
    policyId: 'POL-003',
    insuredName: 'Ana Lucía Torres',
    productId: 'funerario-plan',
    productName: 'Plan Funerario Integral',
    branchCode: 'FUNERAL',
    planCode: 'BASICO',
    planLabel: 'Plan Básico Funerario',
    segmentCode: 'EST',
    segmentLabel: 'Estándar',
    sumInsured: 5000,
    startDate: '2024-02-01',
    endDate: '2025-01-31',
    daysRemaining: 150,
    annualPremium: 180,
    status: 'active',
    debtDays: 0,
    openClaims: 0,
    currency: 'USD',
    channel: 'digital',
  },
  {
    policyId: 'POL-004',
    insuredName: 'Roberto Jiménez Silva',
    productId: 'vida-individual',
    productName: 'Vida Individual',
    branchCode: 'VIDA',
    planCode: 'PLATA',
    planLabel: 'Plan Plata',
    segmentCode: 'MED',
    segmentLabel: 'Mediano',
    sumInsured: 50000,
    startDate: '2023-06-15',
    endDate: '2024-06-14',
    daysRemaining: 90,
    annualPremium: 1200,
    status: 'active',
    debtDays: 0,
    openClaims: 0,
    currency: 'USD',
    channel: 'backoffice',
  },
];

/**
 * @class MockPolicyAdapter
 * @implements IPolicyPort
 * @description Adaptador de pólizas basado en datos en memoria.
 *
 * En producción, reemplazar por un adaptador real como:
 *   - RestPolicyAdapter (consume API REST del Core)
 *   - DatabasePolicyAdapter (consulta directa a BD del Core)
 *   - SoapPolicyAdapter (integración con sistemas legacy)
 */
@Injectable()
export class MockPolicyAdapter implements IPolicyPort {
  async findByPolicyId(
    _tenantId: string,
    policyId: string,
  ): Promise<PolicySnapshot | null> {
    // Simulamos latencia de red (300ms) para hacer el demo más realista
    await this.simulateDelay(300);

    const policy = DEMO_PORTFOLIOS.find((p) => p.policyId === policyId);
    return policy ?? null;
  }

  async findMany(
    _tenantId: string,
    filters: PolicySearchFilters = {},
  ): Promise<PolicySnapshot[]> {
    await this.simulateDelay(500);

    let results = [...DEMO_PORTFOLIOS];

    if (filters.insuredName) {
      const term = filters.insuredName.toLowerCase();
      results = results.filter((p) =>
        p.insuredName.toLowerCase().includes(term),
      );
    }

    if (filters.branchCode) {
      results = results.filter((p) => p.branchCode === filters.branchCode);
    }

    if (filters.status) {
      results = results.filter((p) => p.status === filters.status);
    }

    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;
    const start = (page - 1) * limit;
    return results.slice(start, start + limit);
  }

  private simulateDelay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
