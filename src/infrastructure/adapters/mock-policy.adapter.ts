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
import { PrismaService } from '../../infrastructure/database/prisma.service';
import type {
  IPolicyPort,
  PolicySnapshot,
  PolicySearchFilters,
} from '../../domain/ports/policy.port';

// DEMO_PORTFOLIOS removed to query directly from DB

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
  constructor(private readonly prisma: PrismaService) {}

  async findByPolicyId(
    _tenantId: string,
    policyId: string,
  ): Promise<PolicySnapshot | null> {
    await this.simulateDelay(300);

    const cleanPolicyId = policyId.trim();

    try {
      const coreUrl =
        process.env.CORE_API_URL ||
        'https://qaapisys2000.lamundialdeseguros.com';
      const response = await fetch(
        `${coreUrl}/api/v1/poliza/searchPolizaOnly`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            cnpoliza: cleanPolicyId,
            page: 1,
            steps: 1,
          }),
        },
      );

      if (response.ok) {
        const json = await response.json();
        if (
          json &&
          json.status &&
          json.data &&
          json.data.list &&
          json.data.list.length > 0
        ) {
          const typedItem = json.data.list[0];

          // 2. Consulta secundaria al endpoint de recibos del Core para poblar la prima
          try {
            const receiptResponse = await fetch(
              `${coreUrl}/api/v1/poliza/search-polizaRecibos`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  cnpoliza: typedItem.cnpoliza
                    ? typedItem.cnpoliza.trim()
                    : cleanPolicyId,
                  fanopol: typedItem.fanopol || new Date().getFullYear(),
                  fmespol: typedItem.fmespol || new Date().getMonth() + 1,
                  cramo: typedItem.cramo || 18,
                }),
              },
            );

            if (receiptResponse.ok) {
              const jsonReceipts = await receiptResponse.json();
              if (
                jsonReceipts &&
                jsonReceipts.status &&
                jsonReceipts.recibosInfo &&
                jsonReceipts.recibosInfo.recibos
              ) {
                typedItem.recibos = jsonReceipts.recibosInfo.recibos.map(
                  (r: any) => ({
                    cnrecibo: r.cnrecibo || '',
                    Status_Rec:
                      r.iestadorec === 'P'
                        ? 'Pendiente'
                        : r.iestadorec === 'C'
                          ? 'Cobrado'
                          : r.iestadorec,
                    Monto_Rec_Ext: r.mmontorecext,
                    Monto_Rec: r.mmontorec,
                    ptasamon: r.ptasamon,
                    cmoneda: r.cmoneda ? r.cmoneda.trim() : '',
                    Fdesde_Rec: r.fdesde
                      ? r.fdesde.split('T')[0].split('-').reverse().join('-')
                      : '', // normalizar formato YYYY-MM-DD a DD-MM-YYYY
                    Fhasta_Rec: r.fhasta
                      ? r.fhasta.split('T')[0].split('-').reverse().join('-')
                      : '',
                  }),
                );
              }
            }
          } catch (receiptErr) {
            console.error(
              'Error fetching receipts for policy details:',
              receiptErr,
            );
          }

          return this.mapToSnapshot(policyId, typedItem);
        }
      }
    } catch (error) {
      console.error(
        `Error querying policy directly from Core API for ID ${cleanPolicyId}:`,
        error,
      );
    }

    return null;
  }

  async findMany(
    _tenantId: string,
    filters: PolicySearchFilters = {},
  ): Promise<PolicySnapshot[]> {
    await this.simulateDelay(500);

    // Si se busca por cédula, consumir la API externa de La Mundial
    if (filters.cedula) {
      // Extrae solo el número de documento omitiendo el prefijo de nacionalidad y guiones (ej. V-14484939 -> 14484939)
      const cleanCedula = filters.cedula
        .trim()
        .replace(/^[a-zA-Z]-?/, '')
        .replace(/\./g, '');
      try {
        const coreUrl =
          process.env.CORE_API_URL ||
          'https://qaapisys2000.lamundialdeseguros.com';
        const response = await fetch(`${coreUrl}/api/v1/poliza/searchPoliza`, {
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

        const json = await response.json();
        if (json && json.status && json.data && json.data.list) {
          const mappedPolicies: PolicySnapshot[] = [];

          const list = Array.isArray(json.data.list)
            ? json.data.list
            : Object.values(json.data.list);

          for (const item of list) {
            const typedItem = item;
            const uniquePolicyId =
              typedItem.Nro_Poliza ||
              typedItem.cnpoliza ||
              typedItem.Cnpoliza ||
              typedItem.cpoliza?.toString();
            if (!uniquePolicyId) continue;

            const snapshot = this.mapToSnapshot(uniquePolicyId, typedItem);
            mappedPolicies.push(snapshot);
          }
          return mappedPolicies;
        }
      } catch (err) {
        console.error('Error fetching policies from external API:', err);
      }
    }

    return [];
  }

  async getPlanes(filters: any): Promise<any> {
    const cleanFilters = {
      ctipo: filters?.ctipo ?? 1,
      cramo: filters?.cramo ?? 18,
      cproductor: filters?.cproductor ?? 80080,
      cusuario: filters?.cusuario ?? 7,
      centidad: filters?.centidad ?? 'P',
      citem: filters?.citem ?? '80080',
      iplaca: filters?.iplaca ?? 'N',
    };

    try {
      const coreUrl =
        process.env.CORE_API_URL ||
        'https://qaapisys2000.lamundialdeseguros.com';
      const response = await fetch(`${coreUrl}/api/v1/valrep/planes/v2/`, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          Authorization:
            'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJjdXN1YXJpbyI6MSwieHVzdWFyaW8iOiJEZXNhcnJvbGxvIiwiY2NvcnJlZG9yIjpudWxsLCJ4bG9naW4iOiJkZXNhcnJvbGxvIiwiaWF0IjoxNzgzNDQ5MjY2LCJleHAiOjE3ODQwNTQwNjZ9.oPsqFqR_O28bnnpkGx3LuArvlVlIlp_NN4Ef484v8Pk',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(cleanFilters),
      });

      if (!response.ok) {
        throw new Error(
          `External planes API returned status ${response.status}`,
        );
      }

      const resData = await response.json();
      if (resData && resData.status === false) {
        throw new Error(
          `External planes API indicated failure: ${resData.message}`,
        );
      }

      return resData;
    } catch (err) {
      console.error('Error fetching planes from external API:', err);
      // Fallback a planes mock si falla, no está autorizado o no encuentra planes en nuestro ambiente
      // Esto permite que el sistema siga operando con los códigos correspondientes
      return {
        status: true,
        data: {
          plan: [
            { cplan: 'basico', xplan: 'RCV Básico (SA 10K)', cramo: 18 },
            { cplan: 'rcv-grua', xplan: 'RCV + Grúa (SA 15K)', cramo: 18 },
            { cplan: 'premium', xplan: 'RCV Premium (SA 20K)', cramo: 18 },
          ],
          message: 'Planes encontrados (Fallback)',
        },
      };
    }
  }

  private mapToSnapshot(key: string, typedItem: any): PolicySnapshot {
    // Formatear fecha DD-MM-YYYY a YYYY-MM-DD
    const parseDate = (dStr: string) => {
      if (!dStr) return '';
      // Si ya viene con el año al principio (YYYY-MM-DD o YYYY/MM/DD), normalizar y retornar
      if (/^\d{4}/.test(dStr)) {
        return dStr.split('T')[0].replace(/\//g, '-');
      }
      const parts = dStr.split('-');
      if (parts.length === 3) {
        if (parts[0].length === 4) return dStr;
        return `${parts[2]}-${parts[1]}-${parts[0]}`;
      }
      return dStr;
    };

    const startDate = parseDate(typedItem.Fecha_desde_Pol || typedItem.fdesde);
    const endDate = parseDate(typedItem.Fecha_hasta_Pol || typedItem.fhasta);

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
    if (
      typedItem.recibos &&
      Array.isArray(typedItem.recibos) &&
      typedItem.recibos.length > 1
    ) {
      const parseDDMMYYYY = (str: string): Date | null => {
        if (!str) return null;
        const parts = str.split('-');
        if (parts.length === 3) {
          return new Date(
            parseInt(parts[2], 10),
            parseInt(parts[1], 10) - 1,
            parseInt(parts[0], 10),
          );
        }
        return null;
      };

      const pendingReceipts = typedItem.recibos.filter(
        (r: any) => r.Status_Rec === 'Pendiente',
      );
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

    const descRamo = (
      typedItem.Descripcion_Ramo ||
      typedItem.xramo ||
      ''
    ).toLowerCase();
    const codRamo = typedItem.Codigo_Ramo || typedItem.cramo;
    if (
      codRamo === 6 ||
      descRamo.includes('accidentes') ||
      descRamo.includes('vida')
    ) {
      branchCode = 'vida';
      productId = 'vida-ind';
      productName =
        typedItem.Descripcion_Ramo || typedItem.xramo || 'Vida Individual';
    } else if (
      descRamo.includes('auto') ||
      descRamo.includes('vehiculo') ||
      descRamo.includes('casco')
    ) {
      branchCode = 'rcv';
      productId = 'rcv-auto';
      productName =
        typedItem.Descripcion_Ramo || typedItem.xramo || 'RCV Automóvil';
    } else if (descRamo.includes('funerario') || descRamo.includes('funeral')) {
      branchCode = 'funerario';
      productId = 'funerario-ind';
      productName =
        typedItem.Descripcion_Ramo || typedItem.xramo || 'Funerario Individual';
    }

    const status =
      typedItem.Estatus_Poliza === 'Vigente' || typedItem.xstatus === 'Vigente'
        ? 'active'
        : 'expired';

    return {
      policyId: key,
      cnpoliza: (
        typedItem.Nro_Poliza ||
        typedItem.cnpoliza ||
        typedItem.Cnpoliza ||
        (key.includes('-') ? key.split('-')[0] : key)
      ).trim(),
      fanopoliza:
        typedItem.fanopol ||
        (key.includes('-')
          ? parseInt(key.split('-')[1], 10)
          : new Date().getFullYear()),
      fmespoliza:
        typedItem.fmespol ||
        (key.includes('-')
          ? parseInt(key.split('-')[2], 10)
          : new Date().getMonth() + 1),
      insuredName:
        typedItem.Nombre_Asegurado ||
        typedItem.Nombre_del_Tomador ||
        typedItem.xasegurado ||
        '',
      productId,
      productName,
      branchCode,
      planCode: typedItem.Plan || '',
      planLabel: typedItem.Descripcion_Plan || typedItem.Plan || '',
      segmentCode:
        typedItem.Segmento ||
        (branchCode === 'rcv' ? 'particular' : 'individual'),
      segmentLabel:
        typedItem.Descripcion_Segmento ||
        (branchCode === 'rcv' ? 'Particular' : 'Individual'),
      sumInsured: typedItem.CoberArys || typedItem.Suma_Asegurada || 0,
      startDate,
      endDate,
      daysRemaining,
      annualPremium:
        typedItem.recibos &&
        Array.isArray(typedItem.recibos) &&
        typedItem.recibos.length > 0
          ? typedItem.recibos.reduce(
              (sum: number, r: any) =>
                sum + (parseFloat(r.Monto_Rec_Ext || r.Monto_Rec) || 0),
              0,
            )
          : 0,
      status,
      debtDays,
      openClaims: typedItem.Siniestros || 0,
      currency:
        typedItem.Moneda === 'BOLIVARES' || typedItem.Moneda === 'Bs'
          ? 'VES'
          : typedItem.Moneda === 'EURO' || typedItem.Moneda === 'EUR'
            ? 'EUR'
            : 'USD',
      insuredId: typedItem.CID || typedItem.xdocidentidad_asegurado || '',
      sucursal: typedItem.Sucursal || '',
      intermediario: Array.isArray(typedItem.Intermediario)
        ? typedItem.Intermediario[1]
        : typedItem.cproductor2 || typedItem.xintermediario || '',
      tipoRenovacion: typedItem.Tipo_Renovacion || '',
      recibos: typedItem.recibos || [],
    };
  }

  private simulateDelay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
