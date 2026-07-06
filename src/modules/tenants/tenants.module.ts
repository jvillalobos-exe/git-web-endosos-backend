// ═══════════════════════════════════════════════════════════════════════════
// TENANTS MODULE
// ═══════════════════════════════════════════════════════════════════════════

import { Module } from '@nestjs/common';
import { TenantsController } from './tenants.controller';
import { TenantConfigRepository } from '../../infrastructure/repositories/tenant-config.repository';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { TenantGuard } from '../../common/guards/tenant.guard';

@Module({
  controllers: [TenantsController],
  providers: [PrismaService, TenantConfigRepository, TenantGuard],
  exports: [TenantConfigRepository],
})
export class TenantsModule {}
