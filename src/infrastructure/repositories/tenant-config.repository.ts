// ═══════════════════════════════════════════════════════════════════════════
// TENANT CONFIG REPOSITORY — Infraestructura
// Lee y escribe la configuración completa de una aseguradora desde JSONB.
// ═══════════════════════════════════════════════════════════════════════════

import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

/** Interfaz mínima del InsurerConfig que necesita el backend */
export interface TenantConfigSchema {
  id: string;
  name: string;
  shortName: string;
  endorsementTypes: unknown[];
  branches: unknown[];
  workflows: unknown[];
  channels: unknown[];
  auditSchema: unknown[];
  [key: string]: unknown;
}

/**
 * @class TenantConfigRepository
 * @description Repositorio para la configuración completa del tenant.
 *
 * El campo `schema` en la tabla `tenant_configs` es JSONB, lo que permite
 * almacenar la estructura completa de `InsurerConfig` del frontend sin
 * perder flexibilidad. Cada aseguradora puede tener diferentes estructuras
 * en ciertos campos (ej: campos custom en tariffs o rules).
 */
@Injectable()
export class TenantConfigRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Obtiene la configuración completa de un tenant.
   * @throws NotFoundException si el tenant o su config no existe
   */
  async getByTenantId(tenantId: string): Promise<TenantConfigSchema> {
    const config = await this.prisma.tenantConfig.findUnique({
      where: { tenantId },
    });

    if (!config) {
      throw new NotFoundException(
        `Configuration not found for tenant: ${tenantId}`,
      );
    }

    return config.schema as TenantConfigSchema;
  }

  /**
   * Crea o actualiza la configuración de un tenant (upsert).
   * Incrementa la versión automáticamente para auditoría.
   */
  async upsert(
    tenantId: string,
    schema: TenantConfigSchema,
  ): Promise<TenantConfigSchema> {
    const existing = await this.prisma.tenantConfig.findUnique({
      where: { tenantId },
    });

    const record = await this.prisma.tenantConfig.upsert({
      where: { tenantId },
      create: {
        tenantId,
        schema: schema as any,
        version: 1,
      },
      update: {
        schema: schema as any,
        version: (existing?.version ?? 0) + 1,
      },
    });

    return record.schema as TenantConfigSchema;
  }

  /**
   * Verifica si un tenant tiene configuración guardada.
   */
  async exists(tenantId: string): Promise<boolean> {
    const count = await this.prisma.tenantConfig.count({
      where: { tenantId },
    });
    return count > 0;
  }
}
