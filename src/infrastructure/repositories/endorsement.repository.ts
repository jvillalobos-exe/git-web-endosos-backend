// ═══════════════════════════════════════════════════════════════════════════
// ENDORSEMENT REPOSITORY — Implementación de Infraestructura
// Implementa IEndorsementRepository usando Prisma/PostgreSQL.
// Traduce entre la entidad de dominio (Endorsement) y el modelo de Prisma.
// ═══════════════════════════════════════════════════════════════════════════

import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  IEndorsementRepository,
  EndorsementFilters,
  PaginatedResult,
} from '../../domain/ports/endorsement-repository.port';
import {
  Endorsement,
  EndorsementStatus,
  type EndorsementProps,
  type EndorsementCalculation,
} from '../../domain/entities/endorsement.entity';
import { PrismaService } from '../database/prisma.service';

type PrismaTransaction = Omit<
  PrismaService,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/**
 * @class EndorsementRepository
 * @description Repositorio de persistencia para endosos.
 *
 * Responsabilidades:
 *   1. Traducir Endorsement entity ↔ Prisma model (Mapper pattern)
 *   2. Ejecutar queries con filtro de tenant_id SIEMPRE incluido
 *   3. Soportar transacciones externas (pasando `tx` como parámetro)
 *
 * El filtro por `tenantId` en cada query es una capa de seguridad adicional
 * al RLS de PostgreSQL. Si el RLS falla (ej: no configurado), el filtro
 * en código previene fugas de datos entre tenants.
 */
@Injectable()
export class EndorsementRepository implements IEndorsementRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(tenantId: string, id: string): Promise<Endorsement | null> {
    const record = await this.prisma.endorsement.findFirst({
      where: { id, tenantId },
    });
    return record ? this.toDomain(record) : null;
  }

  async findMany(
    tenantId: string,
    filters: EndorsementFilters = {},
  ): Promise<PaginatedResult<Endorsement>> {
    const page = filters.page ?? 1;
    const limit = Math.min(filters.limit ?? 20, 100); // Max 100 por página
    const skip = (page - 1) * limit;

    const where: Prisma.EndorsementWhereInput = {
      tenantId,
      ...(filters.policyId && { policyId: filters.policyId }),
      ...(filters.status && { status: filters.status as any }),
      ...(filters.endorsementTypeId && { endorsementTypeId: filters.endorsementTypeId }),
    };

    const [records, total] = await Promise.all([
      this.prisma.endorsement.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.endorsement.count({ where }),
    ]);

    return {
      data: records.map((r) => this.toDomain(r)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async save(endorsement: Endorsement, tx?: PrismaTransaction): Promise<Endorsement> {
    const client = tx ?? this.prisma;
    const data = this.toPrisma(endorsement);

    const record = await client.endorsement.create({ data });
    return this.toDomain(record);
  }

  async update(endorsement: Endorsement, tx?: PrismaTransaction): Promise<Endorsement> {
    const client = tx ?? this.prisma;
    const { id, tenantId, createdAt, ...data } = this.toPrisma(endorsement);

    const record = await client.endorsement.update({
      where: { id },
      data,
    });
    return this.toDomain(record);
  }

  async generateEndorsementNumber(tenantId: string, tx?: PrismaTransaction): Promise<string> {
    const client = tx ?? this.prisma;
    const year = new Date().getFullYear();

    // Contar endosos emitidos en el año actual para generar número secuencial
    const count = await client.endorsement.count({
      where: {
        tenantId,
        status: 'EMITTED',
        emittedAt: {
          gte: new Date(`${year}-01-01`),
          lt: new Date(`${year + 1}-01-01`),
        },
      },
    });

    const sequence = String(count + 1).padStart(6, '0');
    return `END-${year}-${sequence}`;
  }

  // ─── Mapper: Prisma Model → Domain Entity ─────────────────────────────────

  private toDomain(record: any): Endorsement {
    return new Endorsement({
      id: record.id,
      tenantId: record.tenantId,
      policyId: record.policyId,
      endorsementTypeId: record.endorsementTypeId,
      routeId: record.routeId,
      channelId: record.channelId,
      effectiveDate: record.effectiveDate,
      status: record.status as EndorsementStatus,
      workflowStep: record.workflowStep,
      calculation: record.calculation as EndorsementCalculation | null,
      formData: record.formData as Record<string, unknown> | null,
      appliedRules: record.appliedRules ?? [],
      endorsementNumber: record.endorsementNumber,
      rejectionReason: record.rejectionReason,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      emittedAt: record.emittedAt,
    });
  }

  // ─── Mapper: Domain Entity → Prisma Data ──────────────────────────────────

  private toPrisma(endorsement: Endorsement): any {
    const props = endorsement.toPlainObject() as EndorsementProps;
    return {
      id: props.id,
      tenantId: props.tenantId,
      policyId: props.policyId,
      endorsementTypeId: props.endorsementTypeId,
      routeId: props.routeId ?? null,
      channelId: props.channelId,
      effectiveDate: props.effectiveDate,
      status: props.status as any,
      workflowStep: props.workflowStep ?? null,
      calculation: props.calculation ? (props.calculation as any) : undefined,
      formData: props.formData ? (props.formData as any) : undefined,
      appliedRules: props.appliedRules,
      endorsementNumber: props.endorsementNumber ?? null,
      rejectionReason: props.rejectionReason ?? null,
      emittedAt: props.emittedAt ?? null,
    };
  }
}
