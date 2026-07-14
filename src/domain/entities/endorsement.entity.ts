// ═══════════════════════════════════════════════════════════════════════════
// ENDORSEMENT ENTITY — Entidad de Dominio
// Representa un Endoso en su estado puro de negocio.
// No tiene dependencias de infraestructura (sin ORM, sin HTTP).
//
// Principio: La entidad es la fuente de verdad del dominio. Las reglas de
// negocio que aplican a UN endoso específico viven aquí como métodos.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Estados posibles de un endoso en su ciclo de vida.
 * Refleja EndorsementStatus del schema de Prisma.
 */
export enum EndorsementStatus {
  DRAFT = 'DRAFT',
  PENDING_PAYMENT = 'PENDING_PAYMENT',
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  EMITTED = 'EMITTED',
  REJECTED = 'REJECTED',
}

/**
 * Cálculo financiero del endoso.
 * Es un snapshot inmutable del resultado de CalculationEngine en el momento de emisión.
 */
export interface EndorsementCalculation {
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
  cnrecibo?: string;
  crecibo?: number;
}

/**
 * Propiedades que inicializan la entidad Endorsement.
 */
export interface EndorsementProps {
  id: string;
  tenantId: string;
  policyId: string;
  endorsementTypeId: string;
  routeId?: string | null;
  channelId: string;
  effectiveDate: Date;
  status: EndorsementStatus;
  workflowStep?: string | null;
  calculation?: EndorsementCalculation | null;
  formData?: Record<string, unknown> | null;
  appliedRules: string[];
  endorsementNumber?: string | null;
  rejectionReason?: string | null;
  createdAt: Date;
  updatedAt: Date;
  emittedAt?: Date | null;
}

/**
 * @class Endorsement
 * @description Entidad de dominio central del módulo.
 *
 * Encapsula las transiciones de estado válidas y las reglas de negocio
 * que aplican a un endoso individual. Usa el patrón Entity de DDD:
 * los métodos mutan el estado interno y devuelven `this` para fluent API.
 */
export class Endorsement {
  private readonly props: EndorsementProps;

  constructor(props: EndorsementProps) {
    this.props = { ...props };
  }

  // ─── Accessors (Read-only views) ──────────────────────────────────────────

  get id(): string {
    return this.props.id;
  }
  get tenantId(): string {
    return this.props.tenantId;
  }
  get policyId(): string {
    return this.props.policyId;
  }
  get endorsementTypeId(): string {
    return this.props.endorsementTypeId;
  }
  get routeId(): string | null | undefined {
    return this.props.routeId;
  }
  get channelId(): string {
    return this.props.channelId;
  }
  get effectiveDate(): Date {
    return this.props.effectiveDate;
  }
  get status(): EndorsementStatus {
    return this.props.status;
  }
  get workflowStep(): string | null | undefined {
    return this.props.workflowStep;
  }
  get calculation(): EndorsementCalculation | null | undefined {
    return this.props.calculation;
  }
  get formData(): Record<string, unknown> | null | undefined {
    return this.props.formData;
  }
  get appliedRules(): string[] {
    return this.props.appliedRules;
  }
  get endorsementNumber(): string | null | undefined {
    return this.props.endorsementNumber;
  }
  get rejectionReason(): string | null | undefined {
    return this.props.rejectionReason;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }
  get updatedAt(): Date {
    return this.props.updatedAt;
  }
  get emittedAt(): Date | null | undefined {
    return this.props.emittedAt;
  }

  // ─── Business Rules ───────────────────────────────────────────────────────

  /**
   * Verifica si el endoso puede ser modificado.
   * Solo los endosos en DRAFT o en flujo de aprobación pueden modificarse.
   */
  canBeModified(): boolean {
    return [
      EndorsementStatus.DRAFT,
      EndorsementStatus.PENDING_APPROVAL,
    ].includes(this.props.status);
  }

  /**
   * Verifica si el endoso ya fue finalizado (emitido o rechazado).
   */
  isFinalized(): boolean {
    return [EndorsementStatus.EMITTED, EndorsementStatus.REJECTED].includes(
      this.props.status,
    );
  }

  /**
   * Verifica si el endoso requiere pago antes de emitirse.
   */
  requiresPayment(): boolean {
    return this.props.status === EndorsementStatus.PENDING_PAYMENT;
  }

  // ─── State Transitions ────────────────────────────────────────────────────

  /**
   * Transición: DRAFT → PENDING_PAYMENT
   * Se activa cuando el endoso tiene un monto a cobrar > 0.
   * @throws {Error} si el estado actual no es DRAFT
   */
  markAsPendingPayment(calculation: EndorsementCalculation): Endorsement {
    this.assertStatus(EndorsementStatus.DRAFT, 'markAsPendingPayment');
    this.props.status = EndorsementStatus.PENDING_PAYMENT;
    this.props.calculation = calculation;
    this.props.updatedAt = new Date();
    return this;
  }

  /**
   * Transición: DRAFT / PENDING_PAYMENT → PENDING_APPROVAL
   * Se activa cuando una regla requiere aprobación manual.
   * @param workflowStep - Nombre del paso de aprobación (rol responsable)
   */
  sendToApproval(
    workflowStep: string,
    calculation?: EndorsementCalculation,
  ): Endorsement {
    const validStates = [
      EndorsementStatus.DRAFT,
      EndorsementStatus.PENDING_PAYMENT,
    ];
    if (!validStates.includes(this.props.status)) {
      throw new Error(
        `Cannot send to approval from status: ${this.props.status}`,
      );
    }
    this.props.status = EndorsementStatus.PENDING_APPROVAL;
    this.props.workflowStep = workflowStep;
    if (calculation) this.props.calculation = calculation;
    this.props.updatedAt = new Date();
    return this;
  }

  /**
   * Transición: DRAFT / PENDING_PAYMENT / PENDING_APPROVAL → EMITTED
   * Finaliza el endoso como emitido.
   * @param endorsementNumber - Número secuencial generado por el sistema
   */
  emit(endorsementNumber: string): Endorsement {
    if (this.isFinalized()) {
      throw new Error(
        `Cannot emit an endorsement in status: ${this.props.status}`,
      );
    }
    this.props.status = EndorsementStatus.EMITTED;
    this.props.endorsementNumber = endorsementNumber;
    this.props.emittedAt = new Date();
    this.props.updatedAt = new Date();
    return this;
  }

  /**
   * Transición: Cualquier estado no finalizado → REJECTED
   * @param reason - Motivo del rechazo (visible al usuario)
   */
  reject(reason: string): Endorsement {
    if (this.isFinalized()) {
      throw new Error(
        `Cannot reject an endorsement in status: ${this.props.status}`,
      );
    }
    this.props.status = EndorsementStatus.REJECTED;
    this.props.rejectionReason = reason;
    this.props.updatedAt = new Date();
    return this;
  }

  /**
   * Asocia las referencias del recibo generado en el Core al cálculo del endoso.
   */
  setCoreReceipt(cnrecibo: string, crecibo: number): void {
    if (this.props.calculation) {
      this.props.calculation = {
        ...this.props.calculation,
        cnrecibo,
        crecibo,
      };
      this.props.updatedAt = new Date();
    }
  }

  /**
   * Transición: PENDING_PAYMENT → EMITTED
   * Finaliza el endoso al verificarse el pago.
   */
  completePayment(endorsementNumber: string): Endorsement {
    this.assertStatus(EndorsementStatus.PENDING_PAYMENT, 'completePayment');
    this.props.status = EndorsementStatus.EMITTED;
    this.props.endorsementNumber = endorsementNumber;
    this.props.emittedAt = new Date();
    this.props.updatedAt = new Date();
    return this;
  }

  /**
   * Serializa la entidad a un objeto plano para persistencia.
   */
  toPlainObject(): EndorsementProps {
    return { ...this.props };
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  private assertStatus(expected: EndorsementStatus, operation: string): void {
    if (this.props.status !== expected) {
      throw new Error(
        `Operation "${operation}" requires status "${expected}", but current status is "${this.props.status}"`,
      );
    }
  }
}
