import { PrismaClient, Role, PlanStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

/**
 * Seed de desenvolvimento:
 *  - Plano básico (referência)
 *  - Tenant de demonstração
 *  - Usuário SUPER_ADMIN
 *  - Usuário ADMIN do tenant
 *
 * Executar com: npm run prisma:seed
 */
async function main(): Promise<void> {
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@botleilao.com.br';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'Admin@12345';
  const passwordHash = await bcrypt.hash(adminPassword, 10);

  const plan = await prisma.plan.upsert({
    where: { id: 'plan-basico' },
    update: {},
    create: {
      id: 'plan-basico',
      name: 'Básico',
      description: 'Para pequenos grupos iniciarem nas vendas por leilão.',
      price: 49.9,
      maxGroups: 2,
      maxUsers: 1,
      features: ['whatsapp'],
      status: PlanStatus.ACTIVE,
    },
  });

  await prisma.plan.upsert({
    where: { id: 'plan-profissional' },
    update: {},
    create: {
      id: 'plan-profissional',
      name: 'Profissional',
      description: 'Para operações em crescimento, com mais grupos e usuários.',
      price: 99.9,
      maxGroups: 5,
      maxUsers: 2,
      features: ['whatsapp', 'relatorios', 'listas'],
      status: PlanStatus.ACTIVE,
    },
  });

  const tenant = await prisma.tenant.upsert({
    where: { email: 'demo@botleilao.com.br' },
    update: {},
    create: {
      id: 'tenant-demo',
      name: 'Leiloeiro Demo',
      email: 'demo@botleilao.com.br',
    },
  });

  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      tenantId: tenant.id,
      name: 'Administrador da Plataforma',
      email: adminEmail,
      password: passwordHash,
      role: Role.SUPER_ADMIN,
    },
  });

  await prisma.user.upsert({
    where: { email: 'demo@botleilao.com.br' },
    update: {},
    create: {
      tenantId: tenant.id,
      name: 'Leiloeiro Demo',
      email: 'demo@botleilao.com.br',
      password: passwordHash,
      role: Role.ADMIN,
    },
  });

  await prisma.subscription.upsert({
    where: { tenantId_planId: { tenantId: tenant.id, planId: plan.id } },
    update: {},
    create: {
      tenantId: tenant.id,
      planId: plan.id,
    },
  });

  console.log('Seed concluído: plano, tenant demo e usuários criados.');
}

main()
  .catch((error) => {
    console.error('Erro no seed:', error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
