// ═══════════════════════════════════════════════════════════════════════════
// POLICY PORT — Puerto de Dominio (Hexagonal Architecture)
//
// Este es el contrato que CADA ASEGURADORA debe implementar para conectar
// su sistema de pólizas (Core) al Motor de Endosos.
//
// Principio Hexagonal: El dominio define la interfaz (el "puerto").
// La infraestructura provee la implementación (el "adaptador").
//
// Una aseguradora puede implementar esto con:
//   - Una llamada a su API REST interna
//   - Una consulta directa a su base de datos
//   - Un mensaje en una cola (async)
//   - Un mock para testing / demo
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Snapshot de una póliza en el momento de la consulta.
 * Este es el contrato de datos que el Motor espera recibir.
 * La aseguradora es responsable de mapear sus datos a este formato.
 */
export interface PolicySnapshot {
  /** Identificador único de la póliza en el sistema de la aseguradora */
  policyId: string;
  /** Nombre completo del asegurado/tomador */
  insuredName: string;
  /** ID del producto contratado (debe existir en la config del tenant) */
  productId: string;
  /** Nombre del producto para display */
  productName: string;
  /** Código de ramo (branch) al que pertenece el producto */
  branchCode: string;
  /** Código del plan actual del asegurado */
  planCode: string;
  /** Etiqueta legible del plan actual */
  planLabel: string;
  /** Código del segmento del asegurado (para lookup en el tarifario) */
  segmentCode: string;
  /** Etiqueta legible del segmento */
  segmentLabel: string;
  /** Suma asegurada actual */
  sumInsured: number;
  /** Fecha de inicio de vigencia (ISO 8601: YYYY-MM-DD) */
  startDate: string;
  /** Fecha de fin de vigencia (ISO 8601: YYYY-MM-DD) */
  endDate: string;
  /** Días restantes de vigencia (calculados por el adaptador) */
  daysRemaining: number;
  /** Prima anual actualmente vigente */
  annualPremium: number;
  /** Estado de la póliza */
  status: 'active' | 'expired' | 'suspended' | 'cancelled';
  /** Días de deuda/mora (usado por reglas de elegibilidad) */
  debtDays: number;
  /** Número de siniestros abiertos (usado por reglas de elegibilidad) */
  openClaims: number;
  /** Código de moneda ISO 4217 */
  currency: string;
  /** Canal de origen de la póliza (opcional) */
  channel?: string;
  /** Cédula/Identificación real del asegurado (opcional) */
  insuredId?: string;
  /** Sucursal de emisión (opcional) */
  sucursal?: string;
  /** Intermediario / Productor (opcional) */
  intermediario?: string;
  /** Tipo de renovación (opcional) */
  tipoRenovacion?: string;
  /** Listado de recibos de cobro asociados (opcional) */
  recibos?: any[];
  /** Número de póliza en la tabla adpoliza del Core (opcional) */
  cnpoliza?: string;
  /** Año de la póliza (fanopol) (opcional) */
  fanopoliza?: number;
  /** Mes de la póliza (fmespol) (opcional) */
  fmespoliza?: number;
}

/**
 * @interface IPolicyPort
 * @description Puerto de entrada para consultar pólizas del Core del asegurador.
 *
 * IMPLEMENTACIÓN REQUERIDA:
 * Cada aseguradora DEBE crear un adaptador que implemente esta interfaz
 * y registrarlo en el módulo NestJS con el token de inyección `POLICY_PORT`.
 *
 * @example
 * ```typescript
 * // mi-aseguradora-policy.adapter.ts
 * @Injectable()
 * export class MiAseguradoraPolicyAdapter implements IPolicyPort {
 *   async findByPolicyId(tenantId: string, policyId: string): Promise<PolicySnapshot | null> {
 *     // Llamar a la API interna de Mi Aseguradora
 *     const response = await this.coreApiClient.get(`/policies/${policyId}`);
 *     // Mapear al formato PolicySnapshot
 *     return this.mapper.toPolicySnapshot(response.data);
 *   }
 * }
 * ```
 */
export interface IPolicyPort {
  /**
   * Busca una póliza por su ID en el sistema del asegurador.
   * @param tenantId - ID del tenant (aseguradora) para contexto de la consulta
   * @param policyId - ID de la póliza a consultar
   * @returns El snapshot de la póliza, o null si no existe
   */
  findByPolicyId(tenantId: string, policyId: string): Promise<PolicySnapshot | null>;

  /**
   * Busca múltiples pólizas por criterios de búsqueda.
   * Usado en el módulo de Portfolio (lotes).
   * @param tenantId - ID del tenant
   * @param filters - Criterios de filtrado opcionales
   */
  findMany(tenantId: string, filters?: PolicySearchFilters): Promise<PolicySnapshot[]>;

  /**
   * Consulta el catálogo de planes disponibles en la API externa.
   * @param filters - Parámetros de consulta
   */
  getPlanes(filters: any): Promise<any>;
}

export interface PolicySearchFilters {
  insuredName?: string;
  branchCode?: string;
  productId?: string;
  status?: PolicySnapshot['status'];
  page?: number;
  limit?: number;
  cedula?: string;
  planCode?: string;
}

/**
 * Token de inyección de dependencias para el puerto de pólizas.
 * Se usa en los módulos NestJS: `@Inject(POLICY_PORT_TOKEN)`
 */
export const POLICY_PORT_TOKEN = 'POLICY_PORT';
