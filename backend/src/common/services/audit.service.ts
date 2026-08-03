import { Injectable, Logger } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

/**
 * Serviço de auditoria.
 *
 * Registra eventos sensíveis (login, leilões, lances, alterações de usuários)
 * para rastreabilidade. Falhas de gravação não derrubam o fluxo principal.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(input: {
    tenantId?: string | null;
    userId?: string | null;
    action: AuditAction;
    entity: string;
    entityId?: string | null;
    before?: Prisma.InputJsonValue;
    after?: Prisma.InputJsonValue;
  }): Promise<void> {
    try {
      await this.prisma.audit.create({
        data: {
          tenantId: input.tenantId ?? null,
          userId: input.userId ?? null,
          action: input.action,
          entity: input.entity,
          entityId: input.entityId ?? null,
          before: (input.before as Prisma.InputJsonObject) ?? undefined,
          after: (input.after as Prisma.InputJsonObject) ?? undefined,
        },
      });
    } catch (error) {
      this.logger.error(
        `Falha ao registrar auditoria (${input.action}): ${(error as Error).message}`,
      );
    }
  }
}
