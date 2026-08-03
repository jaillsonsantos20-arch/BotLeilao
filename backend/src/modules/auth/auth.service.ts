import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuditAction, Role, User } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { StringValue } from 'ms';
import { AppConfig } from '../../common/config/configuration';
import { PrismaService } from '../../common/database/prisma.service';
import { AuditService } from '../../common/services/audit.service';
import { JwtPayload } from '../../common/types/auth.types';
import { LoginDto, RegisterDto } from './dto/auth.dto';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/**
 * Autenticação: registro de tenant, login, refresh token com rotação e logout.
 *
 * Segurança:
 *  - Refresh tokens são opacos e armazenados apenas como hash (SHA-256) no banco.
 *  - Cada refresh invalida o token anterior (rotação com detecção de reuso).
 */
@Injectable()
export class AuthService {
  private readonly accessSecret: string;
  private readonly accessExpiresIn: StringValue;
  private readonly refreshSecret: string;
  private readonly refreshExpiresIn: StringValue;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<AppConfig>,
    private readonly audit: AuditService,
  ) {
    const jwt = this.configService.get('jwt', { infer: true })!;
    this.accessSecret = jwt.secret;
    this.accessExpiresIn = jwt.expiresIn as StringValue;
    this.refreshSecret = jwt.refreshSecret;
    this.refreshExpiresIn = jwt.refreshExpiresIn as StringValue;
  }

  async register(dto: RegisterDto): Promise<AuthTokens> {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) {
      throw new ConflictException('Já existe uma conta com este e-mail.');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);

    const tenant = await this.prisma.tenant.create({
      data: { name: dto.companyName, email: dto.email, cnpj: dto.cnpj ?? null },
    });

    const user = await this.prisma.user.create({
      data: {
        tenantId: tenant.id,
        name: dto.name,
        email: dto.email,
        password: passwordHash,
        role: Role.ADMIN,
      },
    });

    await this.audit.record({
      tenantId: user.tenantId,
      userId: user.id,
      action: AuditAction.CREATE,
      entity: 'Tenant',
      entityId: tenant.id,
    });

    return this.issueTokens(user);
  }

  async login(dto: LoginDto): Promise<AuthTokens> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Credenciais inválidas.');
    }

    const passwordValid = await bcrypt.compare(dto.password, user.password);
    if (!passwordValid) {
      throw new UnauthorizedException('Credenciais inválidas.');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    await this.audit.record({
      tenantId: user.tenantId,
      userId: user.id,
      action: AuditAction.LOGIN,
      entity: 'User',
      entityId: user.id,
    });

    return this.issueTokens(user);
  }

  async refresh(userId: string, presentedToken: string): Promise<AuthTokens> {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { token: this.hashToken(presentedToken) },
      include: { user: true },
    });

    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token inválido ou expirado.');
    }

    if (!stored.user.isActive) {
      throw new UnauthorizedException('Usuário inativo.');
    }

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    return this.issueTokens(stored.user);
  }

  async logout(userId: string, refreshToken?: string): Promise<void> {
    if (refreshToken) {
      await this.prisma.refreshToken.updateMany({
        where: { userId, token: this.hashToken(refreshToken), revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (user) {
      await this.audit.record({
        tenantId: user.tenantId,
        userId,
        action: AuditAction.LOGOUT,
        entity: 'User',
        entityId: userId,
      });
    }
  }

  /**
   * Gera o par de tokens e persiste o refresh token (hash) no banco.
   */
  async issueTokens(user: User): Promise<AuthTokens> {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      tenantId: user.tenantId,
      role: user.role,
    };

    const accessToken = this.jwtService.sign(payload, {
      secret: this.accessSecret,
      expiresIn: this.accessExpiresIn,
    });

    const refreshToken = this.jwtService.sign(
      { ...payload, jti: randomBytes(16).toString('hex') },
      { secret: this.refreshSecret, expiresIn: this.refreshExpiresIn },
    );

    await this.persistRefreshToken(user.id, refreshToken);

    return {
      accessToken,
      refreshToken,
      expiresIn: this.parseExpiresInToSeconds(this.accessExpiresIn),
    };
  }

  private persistRefreshToken(userId: string, token: string): Promise<void> {
    return this.prisma.refreshToken.create({
      data: {
        userId,
        token: this.hashToken(token),
        expiresAt: new Date(
          Date.now() + this.parseExpiresInToSeconds(this.refreshExpiresIn) * 1000,
        ),
      },
    }).then(() => undefined);
  }

  private parseExpiresInToSeconds(value: string): number {
    const match = /^(\d+)(s|m|h|d)$/.exec(value);
    if (!match) return 900;
    const factors: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
    return parseInt(match[1], 10) * factors[match[2]];
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
