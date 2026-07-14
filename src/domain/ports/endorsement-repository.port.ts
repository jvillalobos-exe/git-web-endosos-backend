// ═══════════════════════════════════════════════════════════════════════════
// ENDORSEMENT REPOSITORY PORT — Puerto de Persistencia
//
// Define el contrato de persistencia para la entidad Endorsement.
// La infraestructura (Prisma) implementa este puerto.
// ═══════════════════════════════════════════════════════════════════════════

import { Endorsement } from '../entities/endorsement.entity';

export interface EndorsementFilters {
  policyId?: string;
  status?: string;
  endorsementTypeId?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * @interface IEndorsementRepository
 * @description Puerto de persistencia para la entidad Endorsement.
 *
 * Las operaciones de escritura deben soportar transacciones externas
 * (pasando el cliente Prisma como argumento) para garantizar atomicidad.
 */
export interface IEndorsementRepository {
  /**
   * Busca un endoso por su ID dentro de un tenant.
   * El filtro por tenantId es OBLIGATORIO para garantizar el aislamiento.
   */
  findById(tenantId: string, id: string): Promise<Endorsement | null>;

  /**
   * Lista endosos de un tenant con filtros y paginación.
   */
  findMany(
    tenantId: string,
    filters?: EndorsementFilters,
  ): Promise<PaginatedResult<Endorsement>>;

  /**
   * Persiste un nuevo endoso.
   * @param tx - Cliente de transacción Prisma (opcional, para operaciones atómicas)
   */
  save(endorsement: Endorsement, tx?: unknown): Promise<Endorsement>;

  /**
   * Actualiza un endoso existente.
   * @param tx - Cliente de transacción Prisma (opcional)
   */
  update(endorsement: Endorsement, tx?: unknown): Promise<Endorsement>;

  /**
   * Genera el próximo número de endoso secuencial para un tenant.
   * Ej: "END-2024-000001"
   */
  generateEndorsementNumber(tenantId: string, tx?: unknown): Promise<string>;

  /**
   * Obtiene estadísticas agregadas y actividades recientes para el dashboard.
   */
  getDashboardStats(tenantId: string): Promise<any>;

  /**
   * Obtiene la traza de auditoría de un endoso.
   */
  findAuditLogs(tenantId: string, endorsementId: string): Promise<any[]>;
}

export const ENDORSEMENT_REPOSITORY_TOKEN = 'ENDORSEMENT_REPOSITORY';
