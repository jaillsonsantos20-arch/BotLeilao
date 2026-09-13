import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuditAction, PlanStatus, Role, SubscriptionStatus, User } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { TOTP } from 'otplib';
import { NobleCryptoPlugin } from '@otplib/plugin-crypto-noble';
import { ScureBase32Plugin } from '@otplib/plugin-base32-scure';
import { createHash, randomBytes } from 'node:crypto';
import { StringValue } from 'ms';
import { AppConfig } from '../../common/config/configuration';
import { PrismaService } from '../../common/database/prisma.service';
import { AuditService } from '../../common/services/audit.service';
import { MailService } from '../../common/services/mail.service';
import { JwtPayload } from '../../common/types/auth.types';
import { LoginDto, RegisterDto } from './dto/auth.dto';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/** Resultado do login: tokens completos OU exigência de código MFA. */
export type LoginResult = AuthTokens | { requiresMfa: true; mfaToken: string };

const RESET_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 min
const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 h

// TOTP: sem tolerância de clock no construtor; aplicada por chamada de verificação.
const totp = new TOTP({
  crypto: new NobleCryptoPlugin(),
  base32: new ScureBase32Plugin(),
});

/**
 * Autenticação: registro de tenant, login (com MFA/TOTP), refresh token com
 * rotação, logout, recuperação de senha e verificação de e-mail.
 *
 * Segurança:
 *  - Refresh tokens são opacos e armazenados apenas como hash (SHA-256) no banco.
 *  - Cada refresh invalida o token anterior (rotação com detecção de reuso).
 *  - Tokens de recuperação/verificação também são armazenados apenas com hash.
 *  - Códigos de recuperação do MFA são armazenados apenas com hash.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly accessSecret: string;
  private readonly accessExpiresIn: StringValue;
  private readonly refreshSecret: string;
  private readonly refreshExpiresIn: StringValue;
  private readonly frontendUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<AppConfig>,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {
    const jwt = this.configService.get('jwt', { infer: true })!;
    this.accessSecret = jwt.secret;
    this.accessExpiresIn = jwt.expiresIn as StringValue;
    this.refreshSecret = jwt.refreshSecret;
    this.refreshExpiresIn = jwt.refreshExpiresIn as StringValue;
    this.frontendUrl = this.configService.get('frontendUrl', { infer: true })!;
  }

  async register(dto: RegisterDto): Promise<AuthTokens> {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) {
      throw new ConflictException('Já existe uma conta com este e-mail.');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);

    const plan = await this.resolvePlan(dto.planId);

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

    if (plan) {
      const trialDays = this.configService.get<number>('subscription.trialDays', { infer: true }) ?? 1;

      await this.prisma.subscription.create({
        data: {
          tenantId: tenant.id,
          planId: plan.id,
          status: SubscriptionStatus.TRIAL,
          trialEndsAt: new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000),
        },
      });
    }

    await this.audit.record({
      tenantId: user.tenantId,
      userId: user.id,
      action: AuditAction.CREATE,
      entity: 'Tenant',
      entityId: tenant.id,
    });

    // Envio de verificação de e-mail (fire-and-forget; não bloqueia o cadastro).
    await this.sendEmailVerification(user.id).catch((error) =>
      this.logger.error(`Falha ao enviar e-mail de verificação: ${(error as Error).message}`),
    );

    return this.issueTokens(user);
  }

  async login(dto: LoginDto): Promise<LoginResult> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Credenciais inválidas.');
    }

    const passwordValid = await bcrypt.compare(dto.password, user.password);
    if (!passwordValid) {
      throw new UnauthorizedException('Credenciais inválidas.');
    }

    // MFA habilitado: não emite tokens ainda; devolve um ticket curto
    // que só pode ser trocado por tokens mediante código TOTP válido.
    if (user.totpEnabled) {
      const mfaToken = this.jwtService.sign(
        { sub: user.id, scope: 'mfa-login' },
        { secret: this.accessSecret, expiresIn: '5m' },
      );
      return { requiresMfa: true, mfaToken };
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

    // Reuso de um token já revogado indica roubo/replay do refresh token:
    // revoga toda a família do usuário para forçar novo login em todos os devices.
    if (stored?.revokedAt) {
      this.logger.warn(
        `Reuso de refresh token detectado (usuário ${stored.userId}). Revogando família de tokens.`,
      );
      await this.prisma.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Sessão expirada. Faça login novamente.');
    }

    if (!stored || stored.expiresAt < new Date()) {
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
   * Busca usuário por e-mail (usado apenas para reenvio de verificação).
   */
  async findUserByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  /**
   * Gera um token de verificação de e-mail (armazenado como hash) e envia
   * o link de confirmação.
   */
  async sendEmailVerification(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('Usuário não encontrado.');
    }
    if (user.emailVerifiedAt) {
      return;
    }

    const token = randomBytes(32).toString('hex');
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerificationToken: this.hashToken(token),
        emailVerificationExpiresAt: new Date(Date.now() + VERIFY_TOKEN_TTL_MS),
      },
    });

    const url = `${this.frontendUrl}/verificar-email?token=${token}`;
    await this.mail.send({
      to: user.email,
      subject: 'Confirme seu e-mail no LanceZap',
      text: `Olá! Confirme seu e-mail para ativar sua conta: ${url}\n\nO link é válido por 24 horas.`,
      html: `<p>Olá! Confirme seu e-mail clicando no link abaixo:</p><p><a href="${url}">Confirmar e-mail</a></p><p>O link é válido por 24 horas.</p>`,
    });
  }

  /**
   * Confirma o e-mail a partir do token recebido por link.
   */
  async verifyEmail(token: string): Promise<void> {
    const hash = this.hashToken(token);
    const user = await this.prisma.user.findFirst({
      where: { emailVerificationToken: hash },
    });
    if (
      !user ||
      !user.emailVerificationExpiresAt ||
      user.emailVerificationExpiresAt < new Date()
    ) {
      throw new BadRequestException('Link de verificação inválido ou expirado.');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerifiedAt: new Date(),
        emailVerificationToken: null,
        emailVerificationExpiresAt: null,
      },
    });

    await this.audit.record({
      tenantId: user.tenantId,
      userId: user.id,
      action: AuditAction.UPDATE,
      entity: 'User',
      entityId: user.id,
    });
  }

  /**
   * Solicita recuperação de senha: gera token (hash) e envia link por e-mail.
   */
  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      return;
    }

    const token = randomBytes(32).toString('hex');
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordResetToken: this.hashToken(token),
        passwordResetExpiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
      },
    });

    const url = `${this.frontendUrl}/redefinir-senha?token=${token}`;
    await this.mail.send({
      to: user.email,
      subject: 'Redefinição de senha no LanceZap',
      text: `Recebemos uma solicitação de redefinição de senha para sua conta. Se não foi você, ignore este e-mail.\n\nPara definir uma nova senha, acesse: ${url}\n\nO link é válido por 30 minutos.`,
      html: `<p>Recebemos uma solicitação de redefinição de senha. Se não foi você, ignore este e-mail.</p><p><a href="${url}">Definir nova senha</a></p><p>O link é válido por 30 minutos.</p>`,
    });
  }

  /**
   * Redefine a senha a partir do token recebido por e-mail.
   */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    const hash = this.hashToken(token);
    const user = await this.prisma.user.findFirst({
      where: { passwordResetToken: hash },
    });
    if (!user || !user.passwordResetExpiresAt || user.passwordResetExpiresAt < new Date()) {
      throw new BadRequestException('Link de redefinição inválido ou expirado.');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        passwordResetToken: null,
        passwordResetExpiresAt: null,
      },
    });

    await this.prisma.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await this.audit.record({
      tenantId: user.tenantId,
      userId: user.id,
      action: AuditAction.UPDATE,
      entity: 'User',
      entityId: user.id,
    });
  }

  /**
   * Inicia a configuração do MFA: gera segredo TOTP, URL do app autenticador
   * e códigos de recuperação (exibidos uma única vez; armazenados como hash).
   */
  async setupMfa(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('Usuário não encontrado.');
    }
    if (user.totpEnabled) {
      throw new BadRequestException('Autenticação em duas etapas já está ativada.');
    }

    const secret = totp.generateSecret();
    const otpauthUrl = totp.toURI({
      label: user.email,
      issuer: 'LanceZap',
      secret,
    });

    const backupCodes = Array.from({ length: 8 }, () =>
      randomBytes(5).toString('base64url').toUpperCase().slice(0, 8),
    );

    // Os códigos de recuperação ficam armazenados apenas com hash (SHA-256).
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        totpSecret: secret,
        totpBackupCodes: JSON.stringify(backupCodes.map((code) => this.hashToken(code))),
      },
    });

    return { secret, otpauthUrl, backupCodes };
  }

  /**
   * Ativa o MFA após confirmar um código TOTP válido gerado pelo app autenticador.
   */
  async enableMfa(userId: string, code: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('Usuário não encontrado.');
    }
    if (user.totpEnabled) {
      throw new BadRequestException('Autenticação em duas etapas já está ativada.');
    }
    if (!user.totpSecret) {
      throw new BadRequestException('Inicie a configuração do MFA antes de ativá-lo.');
    }

    if (!(await totp.verify(code, { secret: user.totpSecret, epochTolerance: [30, 30] })).valid) {
      throw new BadRequestException('Código inválido.');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { totpEnabled: true },
    });

    await this.audit.record({
      tenantId: user.tenantId,
      userId: user.id,
      action: AuditAction.UPDATE,
      entity: 'User',
      entityId: user.id,
    });
  }

  /**
   * Desativa o MFA. Requer senha atual para confirmar a operação.
   */
  async disableMfa(userId: string, password: string, code: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('Usuário não encontrado.');
    }
    if (!user.totpEnabled) {
      throw new BadRequestException('Autenticação em duas etapas não está ativada.');
    }

    const passwordValid = await bcrypt.compare(password, user.password);
    if (!passwordValid) {
      throw new BadRequestException('Senha incorreta.');
    }

    if (!(await this.verifyTotpOrBackupCode(user, code))) {
      throw new BadRequestException('Código inválido.');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        totpEnabled: false,
        totpSecret: null,
        totpBackupCodes: null,
      },
    });

    await this.audit.record({
      tenantId: user.tenantId,
      userId: user.id,
      action: AuditAction.UPDATE,
      entity: 'User',
      entityId: user.id,
    });
  }

  /**
   * Troca o ticket do login por tokens após validar o código MFA.
   * Um único código de recuperação só pode ser usado uma vez.
   */
  async completeMfaLogin(mfaToken: string, code: string): Promise<AuthTokens> {
    let payload: JwtPayload;
    try {
      payload = this.jwtService.verify<JwtPayload>(mfaToken, { secret: this.accessSecret });
    } catch {
      throw new UnauthorizedException('Sessão de MFA inválida ou expirada. Faça login novamente.');
    }

    if (payload.scope !== 'mfa-login') {
      throw new UnauthorizedException('Token de MFA inválido.');
    }

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.isActive || !user.totpEnabled) {
      throw new UnauthorizedException('Usuário inválido.');
    }

    if (!(await this.verifyTotpOrBackupCode(user, code))) {
      throw new UnauthorizedException('Código de autenticação inválido.');
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

  private async verifyTotpOrBackupCode(user: User, code: string): Promise<boolean> {
    let totpValid = false;
    if (user.totpSecret) {
      try {
        totpValid = (
          await totp.verify(code, { secret: user.totpSecret, epochTolerance: [30, 30] })
        ).valid;
      } catch {
        // Código não é um TOTP numérico de 6 dígitos (ex.: código de recuperação).
        totpValid = false;
      }
    }

    if (totpValid) {
      return true;
    }

    const hashes: string[] = user.totpBackupCodes ? JSON.parse(user.totpBackupCodes) : [];
    const codeHash = this.hashToken(code.toUpperCase());
    if (hashes.includes(codeHash)) {
      // Código de recuperação é de uso único: remove o hash usado.
      const remaining = hashes.filter((h) => h !== codeHash);
      await this.prisma.user.update({
        where: { id: user.id },
        data: { totpBackupCodes: JSON.stringify(remaining) },
      });
      return true;
    }

    return false;
  }

  /** Gera o par de tokens e persiste o refresh token (hash) no banco. */
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

  /**
   * Resolve o plano do cadastro: o informado (se ativo) ou o plano padrão.
   * Retorna `null` quando não existe plano ativo (cadastro segue sem assinatura).
   */
  private async resolvePlan(planId?: string) {
    if (planId) {
      const plan = await this.prisma.plan.findUnique({
        where: { id: planId, status: PlanStatus.ACTIVE },
      });
      if (plan) {
        return plan;
      }
      throw new BadRequestException('Plano informado é inválido ou está inativo.');
    }

    return this.prisma.plan.findFirst({
      where: { status: PlanStatus.ACTIVE },
      orderBy: { price: 'asc' },
    });
  }
}
