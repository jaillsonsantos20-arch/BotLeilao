import { Injectable, NotFoundException } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { Group } from '@prisma/client';
import { buildPaginatedResult, PaginatedResult } from '../../common/dto/pagination.dto';
import { PrismaService } from '../../common/database/prisma.service';
import { CreateGroupDto, UpdateGroupDto } from './dto/group.dto';

export const LINK_CODE_TTL_MS = 10 * 60 * 1000;

/**
 * Gestão de grupos de WhatsApp por tenant.
 * O `whatsappGroupId` é o identificador estável do grupo na plataforma do WhatsApp.
 */
@Injectable()
export class GroupsService {
  constructor(private readonly prisma: PrismaService) {}

  /** tenantId -> código de vinculação ativo (validade curta) */
  private readonly linkCodes = new Map<
    string,
    { code: string; expiresAt: Date }
  >();

  /**
   * Gera um código curto para vincular um grupo direto do WhatsApp.
   * O admin envia `!vincular <codigo>` no grupo e o bot o cria no painel.
   */
  generateLinkCode(tenantId: string): { code: string; expiresAt: Date } {
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let index = 0; index < 6; index += 1) {
      code += chars[randomInt(chars.length)];
    }
    const expiresAt = new Date(Date.now() + LINK_CODE_TTL_MS);
    this.linkCodes.set(tenantId, { code, expiresAt });
    return { code, expiresAt };
  }

  /**
   * Valida e consome um código de vinculação (uso único).
   */
  consumeLinkCode(tenantId: string, code: string): boolean {
    const entry = this.linkCodes.get(tenantId);
    if (!entry) return false;
    this.linkCodes.delete(tenantId);

    if (entry.expiresAt.getTime() < Date.now()) return false;
    return entry.code.toUpperCase() === code.trim().toUpperCase();
  }

  async create(tenantId: string, dto: CreateGroupDto): Promise<Group> {
    return this.prisma.group.create({
      data: {
        tenantId,
        name: dto.name,
        whatsappGroupId: dto.whatsappGroupId,
        description: dto.description ?? null,
      },
    });
  }

  async list(
    tenantId: string,
    params: { page?: number; limit?: number },
  ): Promise<PaginatedResult<Group & { openAuctionCount: number }>> {
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.group.findMany({
        where: { tenantId },
        include: {
          auctions: {
            where: { status: 'OPEN' },
            select: { id: true, productName: true, endsAt: true, initialValue: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.group.count({ where: { tenantId } }),
    ]);

    const enriched = data.map((group) => ({
      ...group,
      openAuctionCount: group.auctions.length,
      openAuction: group.auctions[0] ?? null,
    }));

    return buildPaginatedResult(
      enriched.map(({ auctions, ...rest }) => rest),
      total,
      page,
      limit,
    );
  }

  async findById(tenantId: string, groupId: string): Promise<Group> {
    const group = await this.prisma.group.findFirst({ where: { id: groupId, tenantId } });
    if (!group) {
      throw new NotFoundException('Grupo não encontrado.');
    }
    return group;
  }

  /**
   * Busca o grupo cadastrado do tenant pelo id estável do WhatsApp.
   * Usado pelo bot para mapear mensagens do grupo para o tenant correto.
   */
  async findByWhatsAppId(whatsappGroupId: string): Promise<(Group & { tenantId: string }) | null> {
    return this.prisma.group.findFirst({
      where: { whatsappGroupId, isActive: true },
    });
  }

  async update(
    tenantId: string,
    groupId: string,
    dto: UpdateGroupDto,
  ): Promise<Group> {
    await this.findById(tenantId, groupId);
    return this.prisma.group.update({
      where: { id: groupId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
  }

  async remove(tenantId: string, groupId: string): Promise<void> {
    await this.findById(tenantId, groupId);
    await this.prisma.group.delete({ where: { id: groupId } });
  }
}
