// ═══════════════════════════════════════════════════════════════════════════
// CALCULATION ENGINE SERVICE — Servicio de Dominio
// Ejecuta el cálculo financiero de un endoso.
//
// Principio: Ninguna fórmula está hardcodeada — todo viene de la
// configuración del tenant (EndorsementRouteConfig).
//
// Este servicio es la contraparte del calculationEngine.ts del frontend.
// ═══════════════════════════════════════════════════════════════════════════

import { Injectable, Logger } from '@nestjs/common';
import type { PolicySnapshot } from '../ports/policy.port';

// ─── Tipos del sistema de cálculo ────────────────────────────────────────────

export interface TariffConfig {
  type: 'table' | 'formula' | 'api';
  table?: TariffRow[];
  formula?: string;
  variables?: Record<string, number | string>;
}

export interface TariffRow {
  id: string;
  segmentCode: string;
  planCode: string;
  annualPremium: number;
}

export interface TaxRuleConfig {
  name: string;
  type: 'percentage' | 'fixed';
  value: number;
  appliesTo: 'difference' | 'full-premium' | 'admin-fee';
}

export interface EndorsementRouteConfig {
  id: string;
  endorsementTypeId: string;
  sourcePlanCode: string;
  targetPlanCode: string;
  targetPlanLabel: string;
  prorateMethod: 'days-remaining' | 'full-difference' | 'fixed-fee' | 'no-charge';
  prorateFormula?: string;
  fixedFee?: number;
  taxRules: TaxRuleConfig[];
}

export interface EndorsementCalculationResult {
  sourcePlan: string;
  targetPlan: string;
  currentPremium: number;
  targetPremium: number;
  annualDifference: number;
  daysRemaining: number;
  prorateMethod: string;
  proratedAmount: number;
  taxes: Array<{ name: string; rate: number; amount: number }>;
  adminFee: number;
  totalCharge: number;
  formula: string;
}

/**
 * @class CalculationEngineService
 * @description Servicio de dominio para el cálculo financiero de endosos.
 *
 * Implementa los 4 métodos de prorrateo soportados por el motor:
 *   - days-remaining: Prima proporcional a días restantes de vigencia
 *   - full-difference: Diferencia anual completa sin prorratear
 *   - fixed-fee:       Cargo fijo configurado en la ruta
 *   - no-charge:       Sin cargo (endoso gratuito)
 *
 * También soporta fórmulas custom via `prorateFormula` (expresión JS evaluada).
 */
@Injectable()
export class CalculationEngineService {
  private readonly logger = new Logger(CalculationEngineService.name);

  /**
   * Obtiene la prima anual de un plan desde el tarifario configurado.
   * Prioridad: segment+plan match > solo plan > 0
   */
  getPremiumFromTariff(
    tariff: TariffConfig,
    planCode: string,
    segmentCode: string,
  ): number {
    if (tariff.type === 'table' && tariff.table) {
      // Buscar coincidencia exacta por plan + segmento
      const exactMatch = tariff.table.find(
        (r) => r.planCode === planCode && r.segmentCode === segmentCode,
      );
      if (exactMatch) return exactMatch.annualPremium;

      // Fallback: solo por plan
      const planMatch = tariff.table.find((r) => r.planCode === planCode);
      if (planMatch) return planMatch.annualPremium;
    }

    if (tariff.type === 'formula' && tariff.formula && tariff.variables) {
      return this.evaluateFormula(tariff.formula, tariff.variables);
    }

    return 0;
  }

  /**
   * Calcula el costo de un endoso cuantitativo.
   * Aplica el método de prorrateo definido en la ruta configurada.
   *
   * @param route         - Ruta de endoso con el método de prorrateo
   * @param policy        - Snapshot de la póliza (fuente de datos base)
   * @param targetPremium - Prima del plan destino (del tarifario)
   */
  calculateEndorsement(
    route: EndorsementRouteConfig,
    policy: PolicySnapshot,
    targetPremium: number,
  ): EndorsementCalculationResult {
    const currentPremium = policy.annualPremium;
    const daysRemaining = Math.max(0, policy.daysRemaining);
    const annualDifference = targetPremium - currentPremium;

    let proratedAmount = 0;
    let formula = '';

    // ─── Métodos de Prorrateo ────────────────────────────────────────────
    switch (route.prorateMethod) {
      case 'days-remaining':
        // Fórmula estándar de prorrateo: (diferencia_anual / 365) × días_restantes
        proratedAmount = (annualDifference / 365) * daysRemaining;
        formula = `(${targetPremium} - ${currentPremium}) / 365 × ${daysRemaining} días = ${proratedAmount.toFixed(2)}`;
        break;

      case 'full-difference':
        // Cobra la diferencia anual completa, sin prorratear
        proratedAmount = annualDifference;
        formula = `Diferencia anual completa: ${targetPremium} - ${currentPremium} = ${proratedAmount.toFixed(2)}`;
        break;

      case 'fixed-fee':
        // Cargo fijo definido en la configuración de la ruta
        proratedAmount = route.fixedFee ?? 0;
        formula = `Cargo fijo configurado: ${proratedAmount.toFixed(2)}`;
        break;

      case 'no-charge':
        // Endoso gratuito por configuración (ej: correcciones de datos)
        proratedAmount = 0;
        formula = 'Sin cargo — endoso gratuito por configuración';
        break;

      default:
        // Fórmula custom evaluada dinámicamente
        if (route.prorateFormula) {
          proratedAmount = this.evaluateFormula(route.prorateFormula, {
            currentPremium,
            targetPremium,
            annualDifference,
            daysRemaining,
            daysInYear: 365,
          });
          formula = `Fórmula custom: ${route.prorateFormula} = ${proratedAmount.toFixed(2)}`;
        }
    }

    // ─── Cálculo de Impuestos ────────────────────────────────────────────
    const taxes = (route.taxRules || []).map((tax) => {
      let base = 0;
      if (tax.appliesTo === 'difference') base = proratedAmount;
      else if (tax.appliesTo === 'full-premium') base = targetPremium;
      // 'admin-fee' se calcula por separado en endosos cualitativos

      const amount =
        tax.type === 'percentage' ? (base * tax.value) / 100 : tax.value;

      return {
        name: tax.name,
        rate: tax.value,
        amount: Math.max(0, amount),
      };
    });

    const taxTotal = taxes.reduce((sum, t) => sum + t.amount, 0);
    const totalCharge = proratedAmount + taxTotal;

    return {
      sourcePlan: policy.planCode,
      targetPlan: route.targetPlanCode,
      currentPremium,
      targetPremium,
      annualDifference,
      daysRemaining,
      prorateMethod: route.prorateMethod,
      proratedAmount,
      taxes,
      adminFee: 0,
      totalCharge,
      formula,
    };
  }

  /**
   * Calcula el cargo administrativo de un endoso cualitativo.
   * @param feeFormula   - Expresión JS, ej: "flatFee + premium * 0.02"
   * @param feeVariables - Variables disponibles en la fórmula
   * @param policy       - Póliza para extraer `premium`
   */
  calculateAdminFee(
    feeFormula: string | undefined,
    feeVariables: Record<string, number> | undefined,
    policy: PolicySnapshot,
  ): number {
    if (!feeFormula || feeFormula === '0') return 0;
    const variables = {
      ...(feeVariables ?? {}),
      premium: policy.annualPremium,
      flatFee: feeVariables?.flatFee ?? 0,
    };
    return this.evaluateFormula(feeFormula, variables);
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  /**
   * Evalúa una fórmula matemática definida como string.
   * Usa Function constructor para inyectar variables de forma controlada.
   * @returns El resultado numérico, o 0 si la evaluación falla
   */
  private evaluateFormula(
    formula: string,
    variables: Record<string, number | string>,
  ): number {
    try {
      const keys = Object.keys(variables);
      const values = Object.values(variables);
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const fn = new Function(...keys, `"use strict"; return (${formula});`);
      return Number(fn(...values));
    } catch (error) {
      this.logger.warn(
        `Error evaluating formula: "${formula}"`,
        error instanceof Error ? error.message : String(error),
      );
      return 0;
    }
  }
}
