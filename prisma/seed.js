const { PrismaClient } = require('@prisma/client');
const { INITIAL_CONFIG } = require('../../git-web-endosos-frontend/src/data/seedData');

const prisma = new PrismaClient();

async function main() {
  const tenantId = 'a1b2c3d4-e5f6-4789-abcd-ef1234567890';
  const laMundialConfig = INITIAL_CONFIG.insurers.find((ins) => ins.id === 'la-mundial');

  if (!laMundialConfig) {
    throw new Error('Configuración de La Mundial de Seguros no encontrada en seedData del frontend.');
  }

  console.log('Iniciando carga de semilla de base de datos...');

  // 1. Upsert Tenant
  const tenant = await prisma.tenant.upsert({
    where: { id: tenantId },
    update: {
      slug: 'la-mundial',
      name: laMundialConfig.name,
      shortName: laMundialConfig.shortName,
      isActive: true,
    },
    create: {
      id: tenantId,
      slug: 'la-mundial',
      name: laMundialConfig.name,
      shortName: laMundialConfig.shortName,
      isActive: true,
    },
  });
  console.log(`[Tenant] Upserted: ${tenant.slug}`);

  // 2. Upsert TenantConfig
  const config = await prisma.tenantConfig.upsert({
    where: { tenantId: tenantId },
    update: {
      schema: laMundialConfig,
    },
    create: {
      tenantId: tenantId,
      schema: laMundialConfig,
    },
  });
  console.log(`[TenantConfig] Upserted configuración para el Tenant ID: ${tenantId}`);
  console.log('¡Semilla de base de datos completada exitosamente!');
}

main()
  .catch((e) => {
    console.error('Error durante la carga de semilla:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
