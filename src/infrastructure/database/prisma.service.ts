// ═══════════════════════════════════════════════════════════════════════════
// PRISMA SERVICE — Infraestructura de Base de Datos
// Wrapper de PrismaClient para NestJS con soporte de:
//   1. Lifecycle hooks (onModuleInit / onModuleDestroy)
//   2. Método de transacción type-safe
//
// Nota Prisma 7: El middleware $use fue removido.
// El aislamiento de tenant se hace a nivel de query en cada repositorio
// filtrando siempre por tenantId en el código, más el RLS de PostgreSQL.
// ═══════════════════════════════════════════════════════════════════════════

import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * @class PrismaService
 * @extends PrismaClient
 * @description Servicio central de base de datos.
 *
 * El aislamiento de datos entre tenants se garantiza por:
 *   1. Filtro explícito de `tenantId` en CADA query de los repositorios
 *   2. Row-Level Security de PostgreSQL (configurado en las migraciones)
 *
 * El tenantId se almacena en memoria por request y es usado por los repositorios.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  /** Almacena el tenant activo para la request actual */
  private currentTenantId: string | null = null;

  constructor() {
    super({
      log:
        process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Connected to PostgreSQL database');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log('Disconnected from PostgreSQL database');
  }

  /**
   * Establece el tenant activo para la request actual.
   * Este método es llamado por el TenantGuard al inicio de cada request.
   *
   * @param tenantId - UUID del tenant, extraído del header X-Tenant-Id
   */
  setCurrentTenant(tenantId: string | null): void {
    this.currentTenantId = tenantId;
  }

  /**
   * Obtiene el tenant activo para la request actual.
   */
  getCurrentTenant(): string | null {
    return this.currentTenantId;
  }

  /**
   * Ejecuta múltiples operaciones en una transacción atómica de PostgreSQL.
   * Si cualquier operación falla, TODAS se revierten (rollback automático).
   *
   * @param fn - Función con las operaciones transaccionales
   * @returns El valor retornado por la función
   */
  async withTransaction<T>(
    fn: (
      tx: Omit<
        PrismaClient,
        | '$connect'
        | '$disconnect'
        | '$on'
        | '$transaction'
        | '$use'
        | '$extends'
      >,
    ) => Promise<T>,
  ): Promise<T> {
    return this.$transaction(fn);
  }
}
