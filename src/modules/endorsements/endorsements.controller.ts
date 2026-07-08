// ═══════════════════════════════════════════════════════════════════════════
// ENDORSEMENTS CONTROLLER — Capa de Presentación
// Expone los endpoints REST del módulo de Endosos.
// Totalmente documentado con Swagger (@ApiTags, @ApiResponse, @ApiHeader).
// ═══════════════════════════════════════════════════════════════════════════

import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  Req,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiHeader,
  ApiParam,
  ApiQuery,
  ApiBody,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { CreateEndorsementUseCase } from '../../application/use-cases/create-endorsement.use-case';
import { EvaluateRulesUseCase } from '../../application/use-cases/evaluate-rules.use-case';
import { QueryPolicyUseCase } from '../../application/use-cases/query-policy.use-case';
import type { IEndorsementRepository } from '../../domain/ports/endorsement-repository.port';
import { ENDORSEMENT_REPOSITORY_TOKEN } from '../../domain/ports/endorsement-repository.port';
import {
  CreateEndorsementDto,
  EvaluateRulesDto,
  CalculateEndorsementDto,
} from '../../application/dtos/create-endorsement.dto';
import { Inject } from '@nestjs/common';
import { TenantConfigRepository } from '../../infrastructure/repositories/tenant-config.repository';
import { CalculationEngineService } from '../../domain/services/calculation-engine.service';

/** Header de autenticación de tenant requerido en todos los endpoints */
const TENANT_HEADER = {
  name: 'X-Tenant-Id',
  description: 'UUID del tenant (aseguradora). Ej: a1b2c3d4-...',
  required: true,
  schema: { type: 'string', format: 'uuid' },
};

@ApiTags('Endosos')
@ApiHeader(TENANT_HEADER)
@UseGuards(TenantGuard)
@Controller('endorsements')
export class EndorsementsController {
  constructor(
    private readonly createEndorsement: CreateEndorsementUseCase,
    private readonly evaluateRules: EvaluateRulesUseCase,
    private readonly queryPolicy: QueryPolicyUseCase,
    @Inject(ENDORSEMENT_REPOSITORY_TOKEN)
    private readonly endorsementRepo: IEndorsementRepository,
    private readonly tenantConfigRepo: TenantConfigRepository,
    private readonly calculationEngine: CalculationEngineService,
  ) {}

  // ─── POST /endorsements ──────────────────────────────────────────────────

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Crear y emitir un endoso',
    description: `
Flujo completo de emisión de endoso:
1. Consulta la póliza al Core (adaptador configurado)
2. Evalúa las reglas de elegibilidad del tenant
3. Calcula el costo según la ruta configurada
4. Persiste en transacción atómica (con auditoría)
5. Retorna el endoso con su estado final

**Estados posibles de respuesta:**
- \`EMITTED\`: Endoso emitido directamente (sin pago ni aprobación)
- \`PENDING_PAYMENT\`: Endoso requiere pago previo
- \`PENDING_APPROVAL\`: Endoso enviado a flujo de aprobación manual
    `,
  })
  @ApiBody({ type: CreateEndorsementDto })
  @ApiResponse({
    status: 201,
    description: 'Endoso creado exitosamente',
    schema: {
      example: {
        id: 'uuid-del-endoso',
        policyId: 'POL-001',
        status: 'EMITTED',
        endorsementNumber: 'END-2025-000001',
        calculation: {
          proratedAmount: 87.5,
          totalCharge: 91.0,
          formula: '(650 - 450) / 365 × 160 días = 87.67',
        },
        emittedAt: '2025-01-15T14:30:00Z',
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Datos inválidos o reglas bloqueantes' })
  @ApiResponse({ status: 404, description: 'Póliza o tenant no encontrado' })
  async create(
    @Body() dto: CreateEndorsementDto,
    @Req() req: Request & { tenantId: string },
  ) {
    const endorsement = await this.createEndorsement.execute(req.tenantId, dto);
    return endorsement.toPlainObject();
  }

  // ─── GET /endorsements ───────────────────────────────────────────────────

  @Get()
  @ApiOperation({
    summary: 'Listar endosos del tenant',
    description: 'Retorna los endosos del tenant activo con filtros y paginación.',
  })
  @ApiQuery({ name: 'policyId', required: false, description: 'Filtrar por póliza' })
  @ApiQuery({ name: 'status', required: false, enum: ['DRAFT', 'PENDING_PAYMENT', 'PENDING_APPROVAL', 'EMITTED', 'REJECTED'] })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiResponse({ status: 200, description: 'Lista paginada de endosos' })
  async findAll(
    @Req() req: Request & { tenantId: string },
    @Query('policyId') policyId?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.endorsementRepo.findMany(req.tenantId, {
      policyId,
      status,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
    });
  }

  // ─── GET /endorsements/:id ───────────────────────────────────────────────

  @Get(':id')
  @ApiOperation({ summary: 'Obtener un endoso por ID' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Endoso encontrado' })
  @ApiResponse({ status: 404, description: 'Endoso no encontrado' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request & { tenantId: string },
  ) {
    const endorsement = await this.endorsementRepo.findById(req.tenantId, id);
    if (!endorsement) {
      throw new Error(`Endoso ${id} no encontrado`);
    }
    return endorsement.toPlainObject();
  }

  // ─── POST /endorsements/evaluate ─────────────────────────────────────────

  @Post('evaluate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Pre-evaluar reglas de elegibilidad',
    description: `
Evalúa las reglas sin crear el endoso.
Retorna la disponibilidad de TODOS los tipos de endoso para la póliza y canal indicados.
Usado en el Paso 3 del wizard (Catálogo) para mostrar el semáforo de disponibilidad.
    `,
  })
  @ApiBody({ type: EvaluateRulesDto })
  @ApiResponse({
    status: 200,
    description: 'Resultado de evaluación de reglas por tipo de endoso',
    schema: {
      example: {
        policyId: 'POL-001',
        channelId: 'backoffice',
        availabilities: [
          {
            endorsementTypeId: 'plan-increment',
            status: 'available',
            blockingRules: [],
            warningRules: [],
          },
        ],
      },
    },
  })
  async evaluate(
    @Body() dto: EvaluateRulesDto,
    @Req() req: Request & { tenantId: string },
  ) {
    return this.evaluateRules.execute(req.tenantId, dto.policyId, dto.channelId);
  }

  // ─── POST /endorsements/calculate ────────────────────────────────────────

  @Post('calculate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Pre-calcular el costo de un endoso',
    description: `
Calcula el costo financiero sin crear el endoso.
Usado en el Paso 4 del wizard (Cálculo) para mostrar el desglose financiero.
    `,
  })
  @ApiBody({ type: CalculateEndorsementDto })
  @ApiResponse({
    status: 200,
    description: 'Resultado del cálculo financiero',
  })
  async calculate(
    @Body() dto: CalculateEndorsementDto,
    @Req() req: Request & { tenantId: string },
  ) {
    // 1. Consultar póliza
    const policy = await this.queryPolicy.findById(req.tenantId, dto.policyId);

    // 2. Cargar configuración del tenant
    const tenantConfig = await this.tenantConfigRepo.getByTenantId(req.tenantId);

    // 3. Encontrar el producto y la ruta
    const allProducts = (tenantConfig.branches as any[]).flatMap(
      (b: any) => b.products ?? [],
    );
    const product = allProducts.find((p: any) => p.id === policy.productId);
    if (!product) {
      return { error: 'Producto no encontrado en la configuración del tenant' };
    }

    let route = (product.endorsementRoutes ?? []).find(
      (r: any) => r.id === dto.routeId,
    );

    if (!route && dto.routeId.startsWith('dynamic-route-')) {
      const targetPlanCode = dto.routeId.replace('dynamic-route-', '');
      route = {
        id: dto.routeId,
        endorsementTypeId: 'ampliacion-plan',
        sourcePlanCode: policy.planCode,
        sourcePlanLabel: policy.planLabel,
        targetPlanCode,
        targetPlanLabel: targetPlanCode,
        allowedChannels: ['backoffice'],
        prorateMethod: 'days-remaining'
      };
    }

    if (!route) {
      return { error: `Ruta "${dto.routeId}" no encontrada` };
    }

    // 4. Calcular
    let targetPremium = this.calculationEngine.getPremiumFromTariff(
      product.tariff,
      route.targetPlanCode,
      policy.segmentCode,
    );

    if (targetPremium === 0 && dto.routeId.startsWith('dynamic-route-')) {
      targetPremium = policy.annualPremium + 100;
    }

    const calculation = this.calculationEngine.calculateEndorsement(
      route,
      policy,
      targetPremium,
    );

    return { policyId: dto.policyId, routeId: dto.routeId, calculation };
  }
}
