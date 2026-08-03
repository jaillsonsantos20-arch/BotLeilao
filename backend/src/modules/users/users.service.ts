import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role, User } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { buildPaginatedResult, PaginatedResult } from '../../common/dto/pagination.dto';
import { PrismaService } from '../../common/database/prisma.service';
import { CreateUserDto, UpdateUserDto } from './dto/user.dto';

/**
 * Gestão de usuários do tenant.
 *
 * Segurança:
 *  - Nunca retorna o hash da senha.
 *  - Nunca permite promover um usuário a SUPER_ADMIN (exclusivo da plataforma).
 */
@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(tenantId: string, dto: CreateUserDto): Promise<Omit<User, 'password'>> {
    const user = await this.prisma.user.create({
      data: {
        tenantId,
        name: dto.name,
        email: dto.email,
        password: await bcrypt.hash(dto.password, 10),
        role: dto.role ?? Role.USER,
      },
    });

    return this.sanitize(user);
  }

  async list(
    tenantId: string,
    params: { page?: number; limit?: number },
  ): Promise<PaginatedResult<Omit<User, 'password'>>> {
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where: { tenantId },
        select: {
          id: true,
          tenantId: true,
          name: true,
          email: true,
          role: true,
          isActive: true,
          lastLoginAt: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.user.count({ where: { tenantId } }),
    ]);

    return buildPaginatedResult(data, total, page, limit);
  }

  async update(
    tenantId: string,
    userId: string,
    dto: UpdateUserDto,
    actorRole: Role,
  ): Promise<Omit<User, 'password'>> {
    const existing = await this.prisma.user.findFirst({ where: { id: userId, tenantId } });
    if (!existing) {
      throw new NotFoundException('Usuário não encontrado.');
    }

    if (dto.role && dto.role === Role.SUPER_ADMIN && actorRole !== Role.SUPER_ADMIN) {
      throw new BadRequestException('Apenas a plataforma pode conceder SUPER_ADMIN.');
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.email !== undefined ? { email: dto.email } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.role !== undefined ? { role: dto.role } : {}),
        ...(dto.password !== undefined
          ? { password: await bcrypt.hash(dto.password, 10) }
          : {}),
      },
    });

    return this.sanitize(user);
  }

  private sanitize(user: User): Omit<User, 'password'> {
    const { password: _password, ...rest } = user;
    return rest;
  }
}
