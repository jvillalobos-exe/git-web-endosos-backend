// ═══════════════════════════════════════════════════════════════════════════
// RULE ENGINE SERVICE — Servicio de Dominio
// Evalúa las reglas de negocio configuradas por la aseguradora.
//
// Este servicio es la contraparte del ruleEngine.ts del frontend.
// Ambos DEBEN producir los mismos resultados dado el mismo contexto.
// Si se modifica la lógica aquí, actualizar el frontend también.
//
// Las condiciones son expresiones JavaScript evaluadas con Function constructor.
// NUNCA usar eval() directo — Function constructor permite control de scope.
// ═══════════════════════════════════════════════════════════════════════════

import { Injectable, Logger } from '@nestjs/common';
import type { PolicySnapshot } from '../ports/policy.port';

// ─── Tipos del sistema de reglas ──────────────────────────────────────────────

/** Configuración de una regla, tal como viene del TenantConfig JSONB */
export interface RuleConfig {
  id: string;
  name: string;
  description: string;
  /** Expresión JavaScript que se evalúa como booleano. Variables disponibles: `policy`, `today` */
  condition: string;
  conditionLabel: string;
  failureAction: 'block' | 'warn' | 'send-to-approval' | 'request-document';
  failureMessage: string;
  severity: 'error' | 'warning' | 'info';
  active: boolean;
}

export interface RuleEvaluation {
  ruleId: string;
  ruleName: string;
  /** true si la regla se CUMPLE (la condición devuelve true) */
  passed: boolean;
  action: RuleConfig['failureAction'];
  /** Mensaje de error/advertencia cuando no pasa */
  message?: string;
  severity: RuleConfig['severity'];
}

export interface EndorsementAvailability {
  endorsementTypeId: string;
  status: 'available' | 'requires-approval' | 'blocked' | 'channel-disabled';
  blockingRules: RuleEvaluation[];
  warningRules: RuleEvaluation[];
}

export interface EndorsementTypeConfig {
  id: string;
  family: 'quantitative' | 'qualitative';
  requiresApproval: boolean;
  approvalWorkflowId?: string;
}

export interface ChannelConfig {
  id: string;
  enabled: boolean;
  allowedEndorsementFamilies: ('quantitative' | 'qualitative')[];
  allowedEndorsementTypeIds: string[];
}

/**
 * @class RuleEngineService
 * @description Servicio de dominio para evaluación de reglas configurables.
 *
 * Patrón: Domain Service — contiene lógica de negocio que opera sobre múltiples
 * entidades/conceptos y no pertenece naturalmente a ninguna entidad específica.
 *
 * Inyección: Este servicio es stateless y se registra como Provider global.
 */
@Injectable()
export class RuleEngineService {
  private readonly logger = new Logger(RuleEngineService.name);

  /**
   * Evalúa una condición de regla contra el contexto de la póliza.
   * Usa Function constructor para evaluar la expresión string de forma
   * controlada, con variables explícitamente inyectadas en el scope.
   *
   * @param condition - Expresión JS, ej: `policy.debtDays === 0`
   * @param context   - Variables disponibles en la expresión
   * @returns `true` si la regla se cumple (póliza es elegible)
   */
  evaluateCondition(
    condition: string,
    context: Record<string, unknown>,
  ): boolean {
    try {
      const keys = Object.keys(context);
      const values = Object.values(context);
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const fn = new Function(...keys, `"use strict"; return (${condition});`);
      return Boolean(fn(...values));
    } catch (error) {
      this.logger.warn(
        `Error evaluating condition: "${condition}"`,
        error instanceof Error ? error.message : String(error),
      );
      // Por seguridad: si la condición falla al evaluarse, la regla no pasa
      return false;
    }
  }

  /**
   * Evalúa un array de reglas contra una póliza.
   * Solo evalúa reglas activas (`rule.active === true`).
   *
   * @param rules  - Array de RuleConfig del TenantConfig
   * @param policy - Snapshot de la póliza del asegurado
   * @returns Array de resultados de evaluación, uno por regla activa
   */
  evaluateRules(rules: RuleConfig[], policy: PolicySnapshot): RuleEvaluation[] {
    const context = {
      policy,
      today: new Date().toISOString().split('T')[0],
    };

    return rules
      .filter((r) => r.active)
      .map((rule) => {
        const passed = this.evaluateCondition(rule.condition, context);
        return {
          ruleId: rule.id,
          ruleName: rule.name,
          passed,
          action: rule.failureAction,
          message: passed ? undefined : rule.failureMessage,
          severity: rule.severity,
        };
      });
  }

  /**
   * Determina la disponibilidad de un tipo de endoso para una póliza.
   * Combina: permisos del canal + resultado de reglas.
   *
   * @returns `EndorsementAvailability` con el estado y las reglas que aplicaron
   */
  checkEndorsementAvailability(
    endorsementType: EndorsementTypeConfig,
    rules: RuleConfig[],
    policy: PolicySnapshot,
    channel: ChannelConfig,
  ): EndorsementAvailability {
    // 1. Verificar si el canal está habilitado para este tipo de endoso
    if (!channel.enabled) {
      return {
        endorsementTypeId: endorsementType.id,
        status: 'channel-disabled',
        blockingRules: [],
        warningRules: [],
      };
    }

    const channelAllowsFamily = channel.allowedEndorsementFamilies.includes(
      endorsementType.family,
    );
    const channelAllowsType =
      channel.allowedEndorsementTypeIds.length === 0 ||
      channel.allowedEndorsementTypeIds.includes(endorsementType.id);

    if (!channelAllowsFamily || !channelAllowsType) {
      return {
        endorsementTypeId: endorsementType.id,
        status: 'channel-disabled',
        blockingRules: [],
        warningRules: [],
      };
    }

    // 2. Evaluar reglas de elegibilidad
    const evaluations = this.evaluateRules(rules, policy);
    const blockingRules = evaluations.filter(
      (e) => !e.passed && e.action === 'block',
    );
    const warningRules = evaluations.filter(
      (e) =>
        !e.passed && (e.action === 'warn' || e.action === 'send-to-approval'),
    );

    const needsApproval =
      endorsementType.requiresApproval ||
      evaluations.some((e) => !e.passed && e.action === 'send-to-approval');

    // 3. Determinar estado final
    let status: EndorsementAvailability['status'];
    if (blockingRules.length > 0) {
      status = 'blocked';
    } else if (
      needsApproval ||
      warningRules.some((e) => e.action === 'send-to-approval')
    ) {
      status = 'requires-approval';
    } else {
      status = 'available';
    }

    return {
      endorsementTypeId: endorsementType.id,
      status,
      blockingRules,
      warningRules,
    };
  }
}
