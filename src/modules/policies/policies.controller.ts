// ═══════════════════════════════════════════════════════════════════════════
// POLICIES CONTROLLER — Consulta de Pólizas
// Expone el puerto IPolicyPort al frontend.
// ═══════════════════════════════════════════════════════════════════════════

import { Controller, Get, Param, Query, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiResponse, ApiHeader, ApiQuery } from '@nestjs/swagger';
import type { Request } from 'express';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { QueryPolicyUseCase } from '../../application/use-cases/query-policy.use-case';

@ApiTags('Pólizas')
@ApiHeader({
  name: 'X-Tenant-Id',
  description: 'UUID del tenant (aseguradora)',
  required: true,
})
@UseGuards(TenantGuard)
@Controller('policies')
export class PoliciesController {
  constructor(private readonly queryPolicyUseCase: QueryPolicyUseCase) {}

  @Get(':policyId')
  @ApiOperation({
    summary: 'Consultar póliza por ID',
    description: `
Consulta una póliza al Core del asegurador via el adaptador configurado.
La respuesta es un PolicySnapshot normalizado al formato del Motor.
    `,
  })
  @ApiParam({ name: 'policyId', type: 'string', example: 'POL-001' })
  @ApiResponse({
    status: 200,
    description: 'Snapshot de la póliza',
    schema: {
      example: {
        policyId: 'POL-001',
        insuredName: 'María García Rodríguez',
        planCode: 'BASIC',
        planLabel: 'Plan Básico',
        annualPremium: 450,
        daysRemaining: 180,
        status: 'active',
        debtDays: 0,
        openClaims: 0,
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Póliza no encontrada' })
  async findById(
    @Param('policyId') policyId: string,
    @Req() req: Request & { tenantId: string },
  ) {
    return this.queryPolicyUseCase.findById(req.tenantId, policyId);
  }

  @Get()
  @ApiOperation({
    summary: 'Listar pólizas del portfolio',
    description: 'Busca pólizas con filtros opcionales (para el módulo Portfolio/Lotes).',
  })
  @ApiQuery({ name: 'insuredName', required: false, description: 'Filtrar por nombre del asegurado' })
  @ApiQuery({ name: 'branchCode', required: false, description: 'Filtrar por ramo (AUTO, VIDA, etc.)' })
  @ApiQuery({ name: 'status', required: false, enum: ['active', 'expired', 'suspended', 'cancelled'] })
  @ApiResponse({ status: 200, description: 'Lista de pólizas' })
  async findMany(
    @Req() req: Request & { tenantId: string },
    @Query('insuredName') insuredName?: string,
    @Query('branchCode') branchCode?: string,
    @Query('status') status?: string,
  ) {
    return this.queryPolicyUseCase.findMany(req.tenantId, {
      insuredName,
      branchCode,
      status: status as any,
    });
  }
}
