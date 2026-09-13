import { Logger } from '@nestjs/common';
import { PlanStatus, PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

/**
 * Seed de primeiro acesso, executado automaticamente no boot em `main.ts`.
 *
 * Idempotente (usa upserts com `update: {}`), então NUNCA sobrescreve senhas
 * de usuários já existentes — apenas garante que o plano, o tenant de demonstração
 * e o administrador existam no primeiro uso. Isso elimina o passo manual de
 * `npm run prisma:seed` em produção.
 */
export async function ensureStartupSeed(): Promise<void> {
  const logger = new Logger('StartupSeed');

  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@botleilao.com.br';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'Admin@12345';
  const passwordHash = await bcrypt.hash(adminPassword, 10);

  const prisma = new PrismaClient();
  try {
    await prisma.plan.upsert({
      where: { id: 'plan-basico' },
      update: {
        name: 'Básico',
        description: 'Para pequenos grupos iniciarem nas vendas por leilão.',
        price: 49.9,
        maxGroups: 1,
        maxUsers: 1,
        features: ['whatsapp', 'listas'],
        status: PlanStatus.ACTIVE,
      },
      create: {
        id: 'plan-basico',
        name: 'Básico',
        description: 'Para pequenos grupos iniciarem nas vendas por leilão.',
        price: 49.9,
        maxGroups: 1,
        maxUsers: 1,
        features: ['whatsapp', 'listas'],
        status: PlanStatus.ACTIVE,
      },
    });

    await prisma.plan.upsert({
      where: { id: 'plan-profissional' },
      update: {
        name: 'Profissional',
        description: 'Para operações em crescimento, com mais grupos e usuários.',
        price: 99.9,
        maxGroups: 5,
        maxUsers: 2,
        features: ['whatsapp', 'relatorios', 'listas', 'listas_ilimitadas'],
        status: PlanStatus.ACTIVE,
      },
      create: {
        id: 'plan-profissional',
        name: 'Profissional',
        description: 'Para operações em crescimento, com mais grupos e usuários.',
        price: 99.9,
        maxGroups: 5,
        maxUsers: 2,
        features: ['whatsapp', 'relatorios', 'listas', 'listas_ilimitadas'],
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
      where: { tenantId_planId: { tenantId: tenant.id, planId: 'plan-basico' } },
      update: {},
      create: {
        tenantId: tenant.id,
        planId: 'plan-basico',
      },
    });

    logger.log('Seed de inicialização concluído (plano, tenant e administradores garantidos).');
  } finally {
    await prisma.$disconnect();
  }
}