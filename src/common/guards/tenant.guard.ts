// ═══════════════════════════════════════════════════════════════════════════
// TENANT GUARD — Seguridad Multitenancy
//
// Extrae el tenant activo del header HTTP y lo inyecta en:
//   1. El request de NestJS (para los controllers)
//   2. El PrismaService (para activar el RLS de PostgreSQL)
//
// HEADER REQUERIDO: X-Tenant-Id: <uuid-del-tenant>
// ═══════════════════════════════════════════════════════════════════════════

import {
  Injectable,
  CanActivate,
  ExecutionContext,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../../infrastructure/database/prisma.service';

/**
 * @class TenantGuard
 * @description Guard de NestJS que valida y establece el tenant activo.
 *
 * Flujo:
 *   1. Leer header `X-Tenant-Id` del request
 *   2. Validar que sea un UUID válido
 *   3. Verificar que el tenant existe y está activo en la BD
 *   4. Inyectar el tenantId en el objeto request
 *   5. Setear el tenant en PrismaService para el RLS
 *
 * Si el header falta o el tenant no existe, retorna 400/404 según el caso.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { tenantId: string }>();

    const tenantId = request.headers['x-tenant-id'] as string;

    if (!tenantId) {
      throw new BadRequestException(
        'Header X-Tenant-Id es requerido. Incluye el UUID de tu aseguradora.',
      );
    }

    // Validación básica de formato UUID
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(tenantId)) {
      throw new BadRequestException(
        'El header X-Tenant-Id debe ser un UUID válido (formato: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx)',
      );
    }

    // Verificar que el tenant existe y está activo
    const tenant = await this.prisma.tenant.findFirst({
      where: { id: tenantId, isActive: true },
      select: { id: true },
    });

    if (!tenant) {
      throw new NotFoundException(
        `Tenant "${tenantId}" no encontrado o no está activo`,
      );
    }

    // Inyectar tenantId en el request para uso en los controllers
    request.tenantId = tenantId;

    // Setear tenant en Prisma para activar RLS en PostgreSQL
    this.prisma.setCurrentTenant(tenantId);

    return true;
  }
}
