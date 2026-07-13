// ═══════════════════════════════════════════════════════════════════════════
// TENANTS CONTROLLER — Gestión de Configuración de Aseguradoras
// ═══════════════════════════════════════════════════════════════════════════

import {
  Controller,
  Get,
  Put,
  Body,
  Param,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiHeader,
  ApiBody,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { TenantConfigRepository } from '../../infrastructure/repositories/tenant-config.repository';
import { IsObject, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateTenantConfigDto {
  @ApiProperty({
    description: 'Configuración completa de la aseguradora (InsurerConfig)',
    type: 'object',
    additionalProperties: true,
  })
  @IsObject()
  @IsNotEmpty()
  schema: Record<string, unknown>;
}

@ApiTags('Configuración de Tenants')
@ApiHeader({
  name: 'X-Tenant-Id',
  description: 'UUID del tenant',
  required: true,
})
@UseGuards(TenantGuard)
@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenantConfigRepo: TenantConfigRepository) {}

  @Get(':id/config')
  @ApiOperation({
    summary: 'Obtener configuración del tenant',
    description: `
Retorna la configuración completa de la aseguradora como JSONB.
Incluye: endorsementTypes, branches, workflows, channels, auditSchema, etc.
    `,
  })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Configuración del tenant (InsurerConfig)',
  })
  @ApiResponse({ status: 404, description: 'Configuración no encontrada' })
  async getConfig(
    @Param('id') id: string,
    @Req() req: Request & { tenantId: string },
  ) {
    // Seguridad: solo puede consultar su propia configuración
    return this.tenantConfigRepo.getByTenantId(req.tenantId);
  }

  @Put(':id/config')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Actualizar configuración del tenant',
    description: `
Actualiza la configuración completa del tenant en JSONB.
Esto conecta el Módulo Configurador del frontend al backend.
La versión se incrementa automáticamente.
    `,
  })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiBody({ type: UpdateTenantConfigDto })
  @ApiResponse({ status: 200, description: 'Configuración actualizada' })
  async updateConfig(
    @Param('id') id: string,
    @Body() dto: UpdateTenantConfigDto,
    @Req() req: Request & { tenantId: string },
  ) {
    return this.tenantConfigRepo.upsert(req.tenantId, dto.schema as any);
  }
}
