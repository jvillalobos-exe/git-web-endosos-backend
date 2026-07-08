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
  private static readonly policyCache = new Map<string, PolicySnapshot>();

  async findByPolicyId(
    _tenantId: string,
    policyId: string,
  ): Promise<PolicySnapshot | null> {
    // Simulamos latencia de red (300ms) para hacer el demo más realista
    await this.simulateDelay(300);

    // Buscar en caché primero (para pólizas externas)
    const cached = MockPolicyAdapter.policyCache.get(policyId);
    if (cached) {
      return cached;
    }

    const policy = DEMO_PORTFOLIOS.find((p) => p.policyId === policyId);
    return policy ?? null;
  }

  async findMany(
    _tenantId: string,
    filters: PolicySearchFilters = {},
  ): Promise<PolicySnapshot[]> {
    await this.simulateDelay(500);

    // Si se busca por cédula, consumir la API externa de La Mundial
    if (filters.cedula) {
      const cleanCedula = filters.cedula.trim().replace(/\./g, '');
      try {
        const response = await fetch('https://qaapisys2000.lamundialdeseguros.com/api/v1/poliza/searchPoliza', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            casegurado: cleanCedula,
          }),
        });

        if (!response.ok) {
          throw new Error(`External API returned status ${response.status}`);
        }

        const json = await response.json() as any;
        if (json && json.status && json.data && json.data.list) {
          const mappedPolicies: PolicySnapshot[] = [];

          for (const [key, item] of Object.entries(json.data.list)) {
            const typedItem = item as any;

            // Formatear fecha DD-MM-YYYY a YYYY-MM-DD
            const parseDate = (dStr: string) => {
              if (!dStr) return '';
              const parts = dStr.split('-');
              if (parts.length === 3) {
                return `${parts[2]}-${parts[1]}-${parts[0]}`;
              }
              return dStr;
            };

            const startDate = parseDate(typedItem.Fecha_desde_Pol);
            const endDate = parseDate(typedItem.Fecha_hasta_Pol);

            // Calcular días restantes de vigencia
            let daysRemaining = 0;
            if (endDate) {
              const end = new Date(endDate);
              const now = new Date();
              end.setHours(0, 0, 0, 0);
              now.setHours(0, 0, 0, 0);
              const diffTime = end.getTime() - now.getTime();
              daysRemaining = Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
            }

            // Calcular días de deuda de recibos pendientes
            let debtDays = 0;
            if (typedItem.recibos && Array.isArray(typedItem.recibos)) {
              const parseDDMMYYYY = (str: string): Date | null => {
                if (!str) return null;
                const parts = str.split('-');
                if (parts.length === 3) {
                  return new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10));
                }
                return null;
              };

              const pendingReceipts = typedItem.recibos.filter((r: any) => r.Status_Rec === 'Pendiente');
              if (pendingReceipts.length > 0) {
                const dates = pendingReceipts
                  .map((r: any) => parseDDMMYYYY(r.Fdesde_Rec))
                  .filter((d): d is Date => d !== null)
                  .sort((a, b) => a.getTime() - b.getTime());

                if (dates.length > 0 && dates[0].getTime() < Date.now()) {
                  const diffTime = Date.now() - dates[0].getTime();
                  debtDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                }
              }
            }

            // Mapeo dinámico de ramo según descripción o código de ramo
            let branchCode = 'vida';
            let productId = 'vida-ind';
            let productName = 'Vida Individual';

            const descRamo = (typedItem.Descripcion_Ramo || '').toLowerCase();
            if (typedItem.Codigo_Ramo === 6 || descRamo.includes('accidentes') || descRamo.includes('vida')) {
              branchCode = 'vida';
              productId = 'vida-ind';
              productName = typedItem.Descripcion_Ramo || 'Vida Individual';
            } else if (descRamo.includes('auto') || descRamo.includes('vehiculo') || descRamo.includes('casco')) {
              branchCode = 'rcv';
              productId = 'rcv-auto';
              productName = typedItem.Descripcion_Ramo || 'RCV Automóvil';
            } else if (descRamo.includes('funerario') || descRamo.includes('funeral')) {
              branchCode = 'funerario';
              productId = 'funerario-ind';
              productName = typedItem.Descripcion_Ramo || 'Funerario Individual';
            }

            const status = typedItem.Estatus_Poliza === 'Vigente' ? 'active' : 'expired';

            const snapshot: PolicySnapshot = {
              policyId: key,
              insuredName: typedItem.Nombre_Asegurado || typedItem.Nombre_del_Tomador || 'Asegurado Sin Nombre',
              productId,
              productName,
              branchCode,
              planCode: typedItem.Plan || 'basico',
              planLabel: typedItem.Descripcion_Plan || 'Vida Básico (SA 20K)',
              segmentCode: 'individual',
              segmentLabel: 'Individual',
              sumInsured: typedItem.CoberArys && typeof typedItem.CoberArys === 'number' && typedItem.CoberArys > 0 ? typedItem.CoberArys : 20000,
              startDate,
              endDate,
              daysRemaining,
              annualPremium: 240,
              status,
              debtDays,
              openClaims: 0,
              currency: typedItem.Moneda === 'DOLARES' ? 'USD' : 'USD',
              insuredId: typedItem.CID || cleanCedula,
              sucursal: typedItem.Sucursal || 'N/A',
              intermediario: Array.isArray(typedItem.Intermediario) ? typedItem.Intermediario[1] : (typedItem.cproductor2 || 'N/A'),
              tipoRenovacion: typedItem.Tipo_Renovacion || 'N/A',
              recibos: typedItem.recibos || [],
            };

            MockPolicyAdapter.policyCache.set(snapshot.policyId, snapshot);
            mappedPolicies.push(snapshot);
          }
          return mappedPolicies;
        }
      } catch (err) {
        console.error('Error fetching policies from external API:', err);
      }
      return [];
    }

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
