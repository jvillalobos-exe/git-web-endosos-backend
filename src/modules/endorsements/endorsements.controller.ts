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
  BadRequestException,
  Sse,
  MessageEvent,
  Res,
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
  PaymentSessionDto,
} from '../../application/dtos/create-endorsement.dto';
import { Inject } from '@nestjs/common';
import { TenantConfigRepository } from '../../infrastructure/repositories/tenant-config.repository';
import { CalculationEngineService } from '../../domain/services/calculation-engine.service';
import { ProcessPaymentCallbackUseCase } from '../../application/use-cases/process-payment-callback.use-case';

/** Header de autenticación de tenant requerido en todos los endpoints */
const TENANT_HEADER = {
  name: 'X-Tenant-Id',
  description: 'UUID del tenant (aseguradora). Ej: a1b2c3d4-...',
  required: true,
  schema: { type: 'string', format: 'uuid' },
};

@ApiHeader(TENANT_HEADER)
@UseGuards(TenantGuard)
@Controller('endorsements')
export class EndorsementsController {
  private readonly paymentStatuses = new Map<
    string,
    { status: string; reference?: string; message?: string }
  >();

  constructor(
    private readonly createEndorsement: CreateEndorsementUseCase,
    private readonly evaluateRules: EvaluateRulesUseCase,
    private readonly queryPolicy: QueryPolicyUseCase,
    @Inject(ENDORSEMENT_REPOSITORY_TOKEN)
    private readonly endorsementRepo: IEndorsementRepository,
    private readonly tenantConfigRepo: TenantConfigRepository,
    private readonly calculationEngine: CalculationEngineService,
    private readonly processPaymentCallback: ProcessPaymentCallbackUseCase,
  ) {}

  // ─── POST /endorsements ──────────────────────────────────────────────────

  @ApiTags('Endosos')
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
  @ApiResponse({
    status: 400,
    description: 'Datos inválidos o reglas bloqueantes',
  })
  @ApiResponse({ status: 404, description: 'Póliza o tenant no encontrado' })
  async create(
    @Body() dto: CreateEndorsementDto,
    @Req() req: Request & { tenantId: string },
  ) {
    const endorsement = await this.createEndorsement.execute(req.tenantId, dto);
    return endorsement.toPlainObject();
  }

  // ─── GET /endorsements ───────────────────────────────────────────────────

  @ApiTags('Endosos')
  @Get()
  @ApiOperation({
    summary: 'Listar endosos del tenant',
    description:
      'Retorna los endosos del tenant activo con filtros y paginación.',
  })
  @ApiQuery({
    name: 'policyId',
    required: false,
    description: 'Filtrar por póliza',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: [
      'DRAFT',
      'PENDING_PAYMENT',
      'PENDING_APPROVAL',
      'EMITTED',
      'REJECTED',
    ],
  })
  @ApiQuery({
    name: 'endorsementTypeId',
    required: false,
    description: 'Filtrar por tipo de endoso',
  })
  @ApiQuery({
    name: 'search',
    required: false,
    type: String,
    description: 'Filtrar por texto de búsqueda',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiResponse({ status: 200, description: 'Lista paginada de endosos' })
  async findAll(
    @Req() req: Request & { tenantId: string },
    @Query('policyId') policyId?: string,
    @Query('status') status?: string,
    @Query('endorsementTypeId') endorsementTypeId?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const result = await this.endorsementRepo.findMany(req.tenantId, {
      policyId,
      status,
      endorsementTypeId,
      search,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
    });
    return {
      ...result,
      data: result.data.map((e) => e.toPlainObject()),
    };
  }

  // ─── GET /endorsements/dashboard/stats ───────────────────────────────────

  @ApiTags('Endosos')
  @Get('dashboard/stats')
  @ApiOperation({ summary: 'Obtener estadísticas agregadas para el dashboard' })
  @ApiResponse({ status: 200, description: 'Estadísticas agregadas' })
  async getDashboardStats(@Req() req: Request & { tenantId: string }) {
    return this.endorsementRepo.getDashboardStats(req.tenantId);
  }

  // ─── GET /endorsements/payment-status/:policyId ──────────────────────────

  @ApiTags('Pagos')
  @Get('payment-status/:policyId')
  @ApiOperation({
    summary: 'Consultar estado del pago para una póliza (Polling)',
    description:
      'Devuelve el estado actual de la transacción del pago. Ideal para verificar constantemente mediante polling.',
  })
  @ApiParam({ name: 'policyId', description: 'ID o número de la póliza' })
  paymentStatus(@Param('policyId') policyId: string) {
    const payment = this.paymentStatuses.get(policyId);
    if (!payment) {
      return { status: 'pending' };
    }

    // Una vez consultado el estado definitivo (éxito o fallo), lo limpiamos de memoria
    if (payment.status === 'success' || payment.status === 'failed') {
      this.paymentStatuses.delete(policyId);
    }

    return payment;
  }

  // ─── GET /endorsements/payment-callback ──────────────────────────────────

  @ApiTags('Pagos')
  @Get('payment-callback')
  @ApiOperation({
    summary: 'Página de retorno tras finalizar el pago (Redirect)',
    description:
      'Registra el resultado del pago y renderiza una interfaz para cerrar la ventana del pago.',
  })
  @ApiQuery({
    name: 'policyId',
    required: true,
    description: 'ID de la póliza',
  })
  @ApiQuery({ name: 'status', required: true, description: 'success o failed' })
  @ApiQuery({
    name: 'reference',
    required: false,
    description: 'Referencia del pago',
  })
  @ApiQuery({ name: 'message', required: false, description: 'Mensaje' })
  async handlePaymentCallbackGet(
    @Query('policyId') policyId: string,
    @Query('status') status: string,
    @Query('reference') reference: string,
    @Query('message') message: string,
    @Res() res: any,
  ) {
    const isSuccessInput = status === 'success';

    const result = await this.processPaymentCallback.execute({
      policyId,
      isSuccess: isSuccessInput,
      reference,
      message,
    });

    const finalStatus = result.status || status;

    this.paymentStatuses.set(policyId, {
      status: finalStatus,
      reference,
      message,
    });

    const isSuccess = finalStatus === 'success';
    const htmlContent = `
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <title>Pago ${isSuccess ? 'Exitoso' : 'Fallido'}</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            background-color: #f1f5f9;
            color: #1e293b;
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
          }
          .card {
            background-color: white;
            padding: 2.5rem;
            border-radius: 1.5rem;
            box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.05);
            text-align: center;
            max-width: 420px;
            width: 100%;
          }
          .icon {
            width: 64px;
            height: 64px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0 auto 1.5rem;
            font-size: 32px;
          }
          .success-icon {
            background-color: #d1fae5;
            color: #059669;
          }
          .error-icon {
            background-color: #fee2e2;
            color: #dc2626;
          }
          h1 {
            font-size: 1.5rem;
            font-weight: 800;
            margin-bottom: 0.5rem;
          }
          p {
            font-size: 0.875rem;
            color: #64748b;
            margin-bottom: 2rem;
            line-height: 1.5;
          }
          .btn {
            background-color: #2563eb;
            color: white;
            border: none;
            padding: 0.75rem 2rem;
            border-radius: 0.75rem;
            font-weight: 700;
            font-size: 0.875rem;
            cursor: pointer;
            transition: background-color 0.2s;
            width: 100%;
          }
          .btn:hover {
            background-color: #1d4ed8;
          }
        </style>
        <script>
          // Cerrar la ventana automáticamente
          setTimeout(() => {
            try {
              window.close();
            } catch (e) {
              console.log('No se pudo cerrar la pestaña automáticamente:', e);
            }
          }, 3000);
        </script>
      </head>
      <body>
        <div class="card">
          <div class="icon ${isSuccess ? 'success-icon' : 'error-icon'}">
            ${isSuccess ? '✓' : '✗'}
          </div>
          <h1>Pago ${isSuccess ? 'Procesado con Éxito' : 'No Completado'}</h1>
          <p>
            ${
              isSuccess
                ? 'Tu pago se ha registrado correctamente en nuestro sistema. El proceso de endoso continuará automáticamente en la plataforma principal.'
                : message ||
                  'Hubo un inconveniente al procesar tu pago. Por favor, intenta de nuevo.'
            }
          </p>
          <button class="btn" onclick="window.close()">Cerrar Ventana</button>
        </div>
      </body>
      </html>
    `;

    res.setHeader('Content-Type', 'text/html');
    return res.status(HttpStatus.OK).send(htmlContent);
  }

  // ─── GET /endorsements/:id ───────────────────────────────────────────────

  @ApiTags('Endosos')
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

  // ─── GET /endorsements/:id/audit ─────────────────────────────────────────

  @ApiTags('Endosos')
  @Get(':id/audit')
  @ApiOperation({ summary: 'Obtener la traza de auditoría de un endoso' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Traza de auditoría' })
  @ApiResponse({ status: 404, description: 'Endoso no encontrado' })
  async getAuditLogs(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request & { tenantId: string },
  ) {
    const endorsement = await this.endorsementRepo.findById(req.tenantId, id);
    if (!endorsement) {
      throw new Error(`Endoso ${id} no encontrado`);
    }
    return this.endorsementRepo.findAuditLogs(req.tenantId, id);
  }

  // ─── POST /endorsements/evaluate ─────────────────────────────────────────

  @ApiTags('Endosos')
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
    return this.evaluateRules.execute(
      req.tenantId,
      dto.policyId,
      dto.channelId,
    );
  }

  // ─── POST /endorsements/calculate ────────────────────────────────────────

  @ApiTags('Endosos')
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
    const tenantConfig = await this.tenantConfigRepo.getByTenantId(
      req.tenantId,
    );

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
        prorateMethod: 'days-remaining',
        taxRules: [],
      };
    }

    if (!route) {
      return { error: `Ruta "${dto.routeId}" no encontrada` };
    }

    // 4. Calcular
    const targetPremium = this.calculationEngine.getPremiumFromTariff(
      product.tariff,
      route.targetPlanCode,
      policy.segmentCode,
    );

    if (targetPremium === 0) {
      throw new BadRequestException(
        `No existe configuración de tarifa para el plan "${route.targetPlanCode}" y segmento "${policy.segmentCode}"`,
      );
    }

    const sourcePremiumFallback = this.calculationEngine.getPremiumFromTariff(
      product.tariff,
      route.sourcePlanCode,
      policy.segmentCode,
    );

    const calculation = this.calculationEngine.calculateEndorsement(
      route,
      policy,
      targetPremium,
      sourcePremiumFallback,
    );

    return { policyId: dto.policyId, routeId: dto.routeId, calculation };
  }

  // ─── POST /endorsements/payment-session ──────────────────────────────────

  @ApiTags('Pagos')
  @Post('payment-session')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Generar sesión de pago SSO en la pasarela externa',
    description:
      'Delega la autenticación y devuelve el redirect_url para la pantalla de pagos.',
  })
  @ApiResponse({
    status: 200,
    description:
      'Sesión de pago SSO generada exitosamente. Contiene la URL del checkout.',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        redirect_url: {
          type: 'string',
          example:
            'https://cierrelmds.exelixitech.com/pagos?token=eyJhbGciOi...',
        },
      },
    },
  })
  async getPaymentSession(@Body() dto: PaymentSessionDto) {
    const { policyId, amount, currency, concept } = dto;

    // =========================================================================
    // TODO: REVERTIR ESTOS CAMBIOS CUANDO SE ESTABILICE EL MÓDULO DE PAGOS
    // Cambiar SIMULATE_PAYMENT a false para reactivar la pasarela de pagos real.
    // =========================================================================
    const SIMULATE_PAYMENT = false;

    if (SIMULATE_PAYMENT) {
      console.log(
        `[SIMULACIÓN PAGO] Cortocircuitando pasarela externa para policyId=${policyId}`,
      );

      const reference = 'SIMULADO-' + Date.now();
      const message =
        'Simulación de cobro exitoso para pruebas de asientos contables';

      // Ejecutar el callback de pago exitoso en segundo plano
      const result = await this.processPaymentCallback.execute({
        policyId,
        isSuccess: true,
        reference,
        message,
      });

      const finalStatus = result.status || 'success';

      // Registrar el estado en el mapa temporal de statuses
      this.paymentStatuses.set(policyId, {
        status: finalStatus,
        reference,
        message,
      });

      // Obtener URL absoluta del callback a partir de las variables de entorno
      const notifyUrl =
        process.env.NOTIFY_URL ||
        'http://localhost:3005/api/endorsements/payment-callback';

      const urlObj = new URL(notifyUrl);
      urlObj.searchParams.set('policyId', policyId);
      urlObj.searchParams.set('status', finalStatus);
      urlObj.searchParams.set('reference', reference);
      urlObj.searchParams.set('message', message);

      const redirectUrl = urlObj.toString();

      return {
        success: true,
        redirect_url: redirectUrl,
      };
    }
    // =========================================================================

    let amountVes = amount;

    // 1. Obtener tasa BCV si la póliza está en USD
    if (currency === 'USD') {
      try {
        const coreApiUrl = process.env.CORE_API_URL || 'http://localhost:3000';
        const bcvRes = await fetch(`${coreApiUrl}/api/v1/valrep/tasaBCV`);
        if (bcvRes.ok) {
          const bcvData = await bcvRes.json();
          const rate = bcvData?.ptasamon || bcvData?.[0]?.ptasamon;
          if (rate) {
            amountVes = amount * parseFloat(rate);
            console.log(
              `Conversión de moneda: ${amount} USD a tasa BCV ${rate} = ${amountVes} VES`,
            );
          }
        }
      } catch (err) {
        console.error(
          'Error al obtener la tasa BCV de Core, usando tasa de fallback 47.0:',
          err,
        );
        amountVes = amount * 47.0; // Fallback razonable si el Core está caído
      }
    }

    // Redondear a 2 decimales
    amountVes = 5; // Forzado temporalmente en 5bs para pruebas reales de pago móvil

    // 2. Realizar petición de delegación de SSO
    const ssoKey =
      process.env.SSO_KEY ||
      'b72c877b3f2841c1989191ac17a46b19ec64f993a97102ac6451b759f284f5ba';
    const ssoUrl =
      process.env.SSO_URL ||
      'https://cierrelmds.exelixitech.com/nexus-api/api/auth/sso-delegate';

    const notifyUrl =
      process.env.NOTIFY_URL ||
      'http://localhost:3005/api/endorsements/payment-callback';

    const payload = {
      target: 'pagos',
      metadata: {
        checkout: {
          title: `Pago Endoso Póliza ${policyId}`,
          totalVes: amountVes,
          lines: [
            {
              label: concept || 'Diferencia de Prima por Endoso',
              amountVes: amountVes,
            },
          ],
        },
        rules: {
          requirePayment: true,
          methods: ['mobile'],
        },
        payload: {
          idOperacion: policyId,
          notifyUrl: notifyUrl,
        },
      },
    };

    try {
      const response = await fetch(ssoUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ssoKey,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new BadRequestException(
          `Error delegando sesión de pago SSO: ${errorText}`,
        );
      }

      const data = await response.json();
      return data; // Contiene redirect_url, success, empresa, modulo, etc.
    } catch (err: any) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException(
        `Fallo de conexión al pasarela de pago: ${err.message}`,
      );
    }
  }

  // ─── POST /endorsements/payment-callback ─────────────────────────────────

  @ApiTags('Pagos')
  @Post('payment-callback')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Recibir confirmación del pago desde la pasarela (Webhook)',
    description:
      'Recibe el estado final del pago y lo almacena temporalmente para que el cliente lo consulte.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        policyId: {
          type: 'string',
          description: 'ID de la póliza asociada al pago',
        },
        status: {
          type: 'string',
          enum: ['success', 'failed'],
          description: 'Estado del pago',
        },
        reference: {
          type: 'string',
          description: 'Referencia de la transacción',
        },
        message: { type: 'string', description: 'Mensaje adicional' },
      },
      required: ['policyId', 'status'],
    },
  })
  async handlePaymentCallbackPost(@Body() payload: any) {
    const policyId =
      payload.idOperacion || payload.payload?.idOperacion || payload.policyId;
    const isSuccess =
      payload.status === 'ok' && payload.paymentVerified === true;
    const status = isSuccess ? 'success' : 'failed';
    const reference = payload.payment?.reference || '';
    const message =
      payload.message ||
      payload.payment?.message ||
      'Error en validación de pago';

    if (!policyId) {
      throw new BadRequestException(
        'ID de operación (idOperacion) no especificado en el callback.',
      );
    }

    const result = await this.processPaymentCallback.execute({
      policyId,
      isSuccess,
      reference,
      message,
    });

    const finalStatus = result.status || status;

    this.paymentStatuses.set(policyId, {
      status: finalStatus,
      reference,
      message,
    });
    return { success: result.success, message: result.message };
  }
}
