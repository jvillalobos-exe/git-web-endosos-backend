// ═══════════════════════════════════════════════════════════════════════════
// APP MODULE — Módulo Raíz de NestJS
// ═══════════════════════════════════════════════════════════════════════════

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EndorsementsModule } from './modules/endorsements/endorsements.module';
import { TenantsModule } from './modules/tenants/tenants.module';

@Module({
  imports: [
    // ConfigModule: Lee las variables de .env y las hace disponibles via ConfigService
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    // Módulos del negocio
    EndorsementsModule,
    TenantsModule,
  ],
})
export class AppModule {}
