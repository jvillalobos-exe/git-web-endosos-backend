// ═══════════════════════════════════════════════════════════════════════════
// MAIN.TS — Bootstrap del Motor Universal de Endosos (Backend)
//
// Configura:
//   - ValidationPipe global (class-validator en todos los endpoints)
//   - Swagger UI en /api
//   - CORS con lista blanca configurable
//   - Prefijo global /api
// ═══════════════════════════════════════════════════════════════════════════

import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');
  const port = process.env.PORT ?? 3000;

  // ─── Prefijo Global de API ─────────────────────────────────────────────
  app.setGlobalPrefix('endosos-services');

  // ─── CORS ──────────────────────────────────────────────────────────────
  const corsOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim());

  app.enableCors({
    origin: corsOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-Id'],
    credentials: true,
  });

  // ─── Validación Global ──────────────────────────────────────────────────
  // whitelist: elimina propiedades no declaradas en los DTOs
  // forbidNonWhitelisted: retorna 400 si hay propiedades extra
  // transform: convierte automáticamente tipos (string → number, etc.)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // ─── Swagger ────────────────────────────────────────────────────────────
  if (process.env.SWAGGER_ENABLED !== 'false') {
    const config = new DocumentBuilder()
      .setTitle('Motor Universal de Endosos — API')
      .setDescription(
        `
## API REST para el Motor Universal de Endosos

### Autenticación Multitenancy
Todos los endpoints requieren el header **X-Tenant-Id** con el UUID de la aseguradora.

### Arquitectura
Este motor implementa arquitectura hexagonal (Ports & Adapters):
- **IPolicyPort**: Adaptador para consultar pólizas del Core del asegurador
- **ICatalogPort**: Adaptador para catálogos de coberturas
- La configuración específica por aseguradora vive en JSONB (\`tenant_configs.schema\`)

### Endpoints disponibles
- \`POST /api/endorsements\` — Crear y emitir endoso (transaccional)
- \`GET /api/endorsements\` — Listar endosos con filtros
- \`POST /api/endorsements/evaluate\` — Pre-evaluar reglas
- \`POST /api/endorsements/calculate\` — Pre-calcular costo
- \`GET /api/policies/:id\` — Consultar póliza al Core
- \`GET /api/tenants/:id/config\` — Obtener configuración del tenant
- \`PUT /api/tenants/:id/config\` — Actualizar configuración del tenant
      `.trim(),
      )
      .setVersion('1.0')
      .addApiKey(
        {
          type: 'apiKey',
          in: 'header',
          name: 'X-Tenant-Id',
          description: 'UUID del tenant (aseguradora)',
        },
        'X-Tenant-Id',
      )
      .addTag('Endosos', 'Operaciones de emisión y consulta de endosos')
      .addTag('Pagos', 'Operaciones de pago y callback de pasarela')
      .addTag('Pólizas', 'Consulta de pólizas al Core del asegurador')
      .addTag(
        'Configuración de Tenants',
        'Gestión de la configuración por aseguradora',
      )
      .build();

    const document = SwaggerModule.createDocument(app, config);
    const swaggerPath = 'endosos-apidocs';
    SwaggerModule.setup(swaggerPath, app, document, {
      swaggerOptions: {
        persistAuthorization: true,
        displayRequestDuration: true,
      },
    });

    logger.log(
      `Swagger UI disponible en: http://localhost:${port}/${swaggerPath}`,
    );
  }

  await app.listen(port);
  logger.log(
    `Motor Universal de Endosos corriendo en: http://localhost:${port}`,
  );
  logger.log(`API base: http://localhost:${port}/api`);
}

bootstrap();
