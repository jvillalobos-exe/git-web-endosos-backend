# Motor Universal de Endosos — Backend (NestJS)

[![NestJS](https://img.shields.io/badge/NestJS-11.x-E0234E?logo=nestjs)](https://nestjs.com/)
[![Prisma](https://img.shields.io/badge/Prisma-7.x-2D3748?logo=prisma)](https://prisma.io/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791?logo=postgresql)](https://postgresql.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.x-3178C6?logo=typescript)](https://typescriptlang.org/)

Motor backend genérico y desacoplado para la gestión de **endosos de pólizas de seguro**. Cualquier aseguradora puede adoptarlo implementando sus propios adaptadores (Ports & Adapters / Arquitectura Hexagonal).

---

## Inicio Rápido

```bash
# 1. Clonar e instalar
cd git-web-endosos-backend
npm install

# 2. Variables de entorno
cp .env.example .env
# Editar .env con tus valores

# 3. Levantar PostgreSQL (Docker)
docker-compose up -d

# 4. Migraciones de base de datos
npx prisma migrate dev --name init

# 5. Iniciar servidor de desarrollo
npm run start:dev
# → http://localhost:3000
# → Swagger UI: http://localhost:3000/api
```

---

## Arquitectura del Sistema

```
┌───────────────────────────────────────────────────────┐
│                  Presentation Layer                    │
│  EndorsementsController | PoliciesController           │
│  TenantsController | TenantGuard                       │
└─────────────────────────┬─────────────────────────────┘
                          │
┌─────────────────────────▼─────────────────────────────┐
│                  Application Layer                     │
│  CreateEndorsementUseCase | EvaluateRulesUseCase       │
│  QueryPolicyUseCase | CalculateEndorsementUseCase      │
└─────────────────────────┬─────────────────────────────┘
                          │
┌─────────────────────────▼─────────────────────────────┐
│                   Domain Layer                         │
│  Endorsement (Entity) | EndorsementStatus (Enum)       │
│  RuleEngineService | CalculationEngineService          │
│  IPolicyPort | IEndorsementRepository (Ports)          │
└─────────────────────────┬─────────────────────────────┘
                          │
┌─────────────────────────▼─────────────────────────────┐
│                Infrastructure Layer                    │
│  PrismaService (PostgreSQL + RLS)                      │
│  EndorsementRepository | TenantConfigRepository        │
│  MockPolicyAdapter → [TU ADAPTADOR REAL]               │
└───────────────────────────────────────────────────────┘
```

---

## 🔌 Guía de Adaptadores para Aseguradoras

Esta es la sección más importante para integrar una nueva aseguradora.

### ¿Qué es un Adaptador?

Un adaptador es una clase que implementa un **Puerto** (interfaz de dominio).
El Motor define el **qué** (interfaz); la aseguradora implementa el **cómo**.

### Puerto Principal: `IPolicyPort`

Este puerto define cómo el Motor consulta pólizas al **Core del asegurador**.

```typescript
// src/domain/ports/policy.port.ts
export interface IPolicyPort {
  findByPolicyId(tenantId: string, policyId: string): Promise<PolicySnapshot | null>;
  findMany(tenantId: string, filters?: PolicySearchFilters): Promise<PolicySnapshot[]>;
}
```

#### El contrato `PolicySnapshot`

Tu adaptador debe mapear los datos de tu Core a este formato:

```typescript
export interface PolicySnapshot {
  policyId: string;        // ID de la póliza en tu sistema
  insuredName: string;     // Nombre del asegurado/tomador
  productId: string;       // Debe coincidir con IDs de TenantConfig.branches.products
  productName: string;
  branchCode: string;      // Código de ramo (ej: "AUTO", "VIDA", "SALUD")
  planCode: string;        // Plan actual (ej: "BASIC", "PLATA", "ORO")
  planLabel: string;       // Etiqueta legible del plan
  segmentCode: string;     // Segmento para lookup en tarifario
  segmentLabel: string;
  sumInsured: number;      // Suma asegurada
  startDate: string;       // ISO 8601: "2024-01-15"
  endDate: string;         // ISO 8601: "2025-01-14"
  daysRemaining: number;   // Días restantes (calculados por tu adaptador)
  annualPremium: number;   // Prima anual vigente
  status: 'active' | 'expired' | 'suspended' | 'cancelled';
  debtDays: number;        // Días de mora (para reglas de elegibilidad)
  openClaims: number;      // Siniestros abiertos (para reglas)
  currency: string;        // Código ISO 4217: "USD", "EUR", "VES"
  channel?: string;
}
```

---

### Ejemplo 1: Adaptador REST (API Interna)

```typescript
// src/infrastructure/adapters/rest-policy.adapter.ts
import { Injectable, HttpService } from '@nestjs/common';
import type { IPolicyPort, PolicySnapshot } from '../../domain/ports/policy.port';

@Injectable()
export class RestPolicyAdapter implements IPolicyPort {
  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  async findByPolicyId(tenantId: string, policyId: string): Promise<PolicySnapshot | null> {
    const baseUrl = this.configService.get('CORE_API_URL');
    const apiKey = this.configService.get('CORE_API_KEY');

    try {
      const response = await this.httpService.axiosRef.get(
        `${baseUrl}/polizas/${policyId}`,
        { headers: { 'X-API-Key': apiKey, 'X-Tenant': tenantId } }
      );

      // ← AQUÍ mapeas la respuesta de tu Core al formato PolicySnapshot
      return this.mapToSnapshot(response.data);
    } catch (error) {
      if (error.response?.status === 404) return null;
      throw error;
    }
  }

  async findMany(tenantId: string, filters?: PolicySearchFilters): Promise<PolicySnapshot[]> {
    // Implementar según la API de tu Core
    return [];
  }

  private mapToSnapshot(coreData: any): PolicySnapshot {
    // Adaptar los campos de tu Core al formato estándar
    return {
      policyId: coreData.numeroPoliza,
      insuredName: `${coreData.asegurado.nombre} ${coreData.asegurado.apellido}`,
      productId: coreData.codigoProducto,
      // ... etc
    } as PolicySnapshot;
  }
}
```

#### Registrar el adaptador en el módulo:

```typescript
// src/modules/endorsements/endorsements.module.ts
{
  provide: POLICY_PORT_TOKEN,
  useClass: RestPolicyAdapter, // ← Cambiar MockPolicyAdapter por tu adaptador
}
```

---

### Ejemplo 2: Adaptador de Base de Datos Directa

```typescript
// src/infrastructure/adapters/database-policy.adapter.ts
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm'; // o cualquier ORM/driver que use tu Core

@Injectable()
export class DatabasePolicyAdapter implements IPolicyPort {
  constructor(private readonly coreDb: DataSource) {}

  async findByPolicyId(tenantId: string, policyId: string): Promise<PolicySnapshot | null> {
    const raw = await this.coreDb.query(
      `SELECT p.*, a.nombre, a.apellido, a.fecha_nac
       FROM polizas p
       JOIN asegurados a ON a.id = p.asegurado_id
       WHERE p.numero = $1`,
      [policyId]
    );

    if (!raw.length) return null;
    return this.mapToSnapshot(raw[0]);
  }
  // ...
}
```

---

### Ejemplo 3: Adaptador para Sistemas Legacy (SOAP/XML)

```typescript
// src/infrastructure/adapters/soap-policy.adapter.ts
import { Injectable } from '@nestjs/common';
import { createClient } from 'soap'; // npm install soap

@Injectable()
export class SoapPolicyAdapter implements IPolicyPort {
  async findByPolicyId(tenantId: string, policyId: string): Promise<PolicySnapshot | null> {
    const client = await createClient(process.env.SOAP_WSDL_URL!);
    const result = await client.ConsultarPolizaAsync({ numeroPoliza: policyId });
    return this.mapXmlToSnapshot(result);
  }
}
```

---

## 🏢 Multitenancy: Aislamiento de Datos

### Estrategia: Row-Level Security (RLS) con `tenant_id`

Cada tabla tiene una columna `tenant_id`. PostgreSQL RLS garantiza que una aseguradora nunca vea datos de otra.

```sql
-- La política de RLS está activada en todas las tablas
CREATE POLICY tenant_isolation ON endorsements
  USING (tenant_id = current_setting('app.current_tenant')::UUID);
```

El `TenantGuard` setea el tenant en cada request:
```
HTTP Header: X-Tenant-Id: <uuid-de-la-aseguradora>
```

### Onboarding de una nueva aseguradora

```sql
-- 1. Registrar el tenant
INSERT INTO tenants (id, slug, name, short_name)
VALUES (gen_random_uuid(), 'mi-aseguradora', 'Mi Aseguradora SA', 'MiAseg');

-- 2. El resto de la configuración se sube via API:
-- PUT /api/tenants/:id/config  con el InsurerConfig JSON
```

---

## Configuración de la Aseguradora (TenantConfig)

La configuración vive en el campo JSONB `tenant_configs.schema`.
Estructura (mapeada al frontend `InsurerConfig`):

```json
{
  "id": "mi-aseguradora",
  "name": "Mi Aseguradora SA",
  "currency": { "code": "USD", "symbol": "$", "decimals": 2 },
  "endorsementTypes": [
    {
      "id": "plan-increment",
      "name": "Incremento de Plan",
      "family": "quantitative",
      "requiresPayment": true,
      "requiresApproval": false
    }
  ],
  "branches": [
    {
      "code": "VIDA",
      "products": [
        {
          "id": "vida-basico",
          "tariff": {
            "type": "table",
            "table": [
              { "planCode": "BASIC", "segmentCode": "A", "annualPremium": 450 },
              { "planCode": "PLATA", "segmentCode": "A", "annualPremium": 650 }
            ]
          },
          "rules": [
            {
              "id": "rule-no-debt",
              "condition": "policy.debtDays === 0",
              "failureAction": "block",
              "failureMessage": "La póliza tiene deuda pendiente"
            }
          ],
          "endorsementRoutes": [
            {
              "id": "basic-to-plata",
              "endorsementTypeId": "plan-increment",
              "sourcePlanCode": "BASIC",
              "targetPlanCode": "PLATA",
              "prorateMethod": "days-remaining",
              "taxRules": [
                { "name": "IVA", "type": "percentage", "value": 16, "appliesTo": "difference" }
              ]
            }
          ]
        }
      ]
    }
  ],
  "channels": [
    {
      "id": "backoffice",
      "name": "Back Office",
      "enabled": true,
      "allowedEndorsementFamilies": ["quantitative", "qualitative"]
    }
  ]
}
```

---

## Endpoints de la API

Ver documentación interactiva: **http://localhost:3000/api**

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `POST` | `/api/endorsements` | Crear y emitir un endoso (transaccional) |
| `GET` | `/api/endorsements` | Listar endosos con filtros |
| `GET` | `/api/endorsements/:id` | Obtener un endoso por ID |
| `POST` | `/api/endorsements/evaluate` | Pre-evaluar reglas de elegibilidad |
| `POST` | `/api/endorsements/calculate` | Pre-calcular costo sin crear |
| `GET` | `/api/policies/:id` | Consultar póliza al Core |
| `GET` | `/api/policies` | Listar pólizas con filtros |
| `GET` | `/api/tenants/:id/config` | Obtener configuración del tenant |
| `PUT` | `/api/tenants/:id/config` | Actualizar configuración del tenant |

---

## Scripts disponibles

```bash
npm run start:dev    # Servidor de desarrollo con hot-reload
npm run build        # Compilar TypeScript
npm run start:prod   # Iniciar servidor de producción
npm run test         # Unit tests
npm run test:e2e     # End-to-end tests
npm run test:cov     # Cobertura de tests

npx prisma studio    # GUI de base de datos
npx prisma migrate dev --name <name>  # Nueva migración
npx prisma generate  # Regenerar cliente Prisma
```

---

## Estructura de Directorios

```
src/
├── application/
│   ├── dtos/                    # Data Transfer Objects (validación Swagger)
│   └── use-cases/               # Casos de uso de la aplicación
├── common/
│   └── guards/                  # TenantGuard (multitenancy)
├── domain/
│   ├── entities/                # Endorsement (entidad de dominio)
│   ├── ports/                   # IPolicyPort, IEndorsementRepository
│   └── services/                # RuleEngineService, CalculationEngineService
├── infrastructure/
│   ├── adapters/                # MockPolicyAdapter (y tus adaptadores reales)
│   ├── database/                # PrismaService
│   └── repositories/            # EndorsementRepository, TenantConfigRepository
├── modules/
│   ├── endorsements/            # EndorsementsModule + Controller
│   ├── policies/                # PoliciesController
│   └── tenants/                 # TenantsModule + Controller
├── app.module.ts
└── main.ts                      # Bootstrap (Swagger, ValidationPipe, CORS)
prisma/
├── schema.prisma                # Modelos de BD (Tenant, Endorsement, Audit)
└── migrations/                  # Migraciones SQL generadas por Prisma
docker/
└── init.sql                     # SQL inicial del contenedor PostgreSQL
```
