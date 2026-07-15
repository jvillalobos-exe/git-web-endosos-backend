const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

const prisma = new PrismaClient();

async function main() {
  console.log("Buscando póliza POL-001 en la caché...");
  try {
    const p = await prisma.policyCache.findUnique({
      where: { policyId: 'POL-001' }
    });
    if (p) {
      console.log("Póliza POL-001 encontrada:");
      console.log(JSON.stringify(p, null, 2));
    } else {
      console.log("Póliza POL-001 NO encontrada en la caché.");
    }
  } catch (error) {
    console.error("Error buscando póliza POL-001:", error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
