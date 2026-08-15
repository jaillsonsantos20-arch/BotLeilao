import { Body, Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { BypassTenantAccess } from '../../common/decorators/bypass-tenant-access.decorator';
import { RequestUser } from '../../common/types/auth.types';
import { AuthService, AuthTokens, LoginResult } from './auth.service';
import {
  DisableMfaDto,
  EnableMfaDto,
  ForgotPasswordDto,
  LoginDto,
  RefreshTokenDto,
  RegisterDto,
  ResendVerificationDto,
  ResetPasswordDto,
  VerifyEmailDto,
  VerifyMfaDto,
} from './dto/auth.dto';
import { JwtRefreshGuard } from './guards/jwt-refresh.guard';
import { ACCESS_TOKEN_COOKIE } from './strategies/jwt.strategy';
import { REFRESH_TOKEN_COOKIE } from './strategies/jwt-refresh.strategy';

const COOKIE_OPTIONS: import('express').CookieOptions = {
  httpOnly: true,
  // Habilite COOKIE_SECURE=true quando o site estiver atrás de HTTPS/TLS.
  // Cookies Secure não são enviados sobre HTTP — quebraria o login na porta 80.
  secure: process.env.COOKIE_SECURE === 'true',
  sameSite: 'lax',
  path: '/',
};

const REFRESH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  private setAuthCookies(res: Response, tokens: AuthTokens): void {
    res.cookie(ACCESS_TOKEN_COOKIE, tokens.accessToken, {
      ...COOKIE_OPTIONS,
      maxAge: tokens.expiresIn * 1000,
    });
    res.cookie(REFRESH_TOKEN_COOKIE, tokens.refreshToken, {
      ...COOKIE_OPTIONS,
      maxAge: REFRESH_COOKIE_MAX_AGE_MS,
    });
  }

  private clearAuthCookies(res: Response): void {
    res.clearCookie(ACCESS_TOKEN_COOKIE, COOKIE_OPTIONS);
    res.clearCookie(REFRESH_TOKEN_COOKIE, COOKIE_OPTIONS);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('register')
  @ApiOperation({ summary: 'Registra um novo cliente (tenant + usuário admin)' })
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthTokens> {
    const tokens = await this.authService.register(dto);
    this.setAuthCookies(res, tokens);
    return tokens;
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('login')
  @ApiOperation({ summary: 'Autentica um usuário e retorna os tokens' })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResult> {
    const result = await this.authService.login(dto);
    // MFA pendente: não emite cookies; o cliente deve resolver o código.
    if ('requiresMfa' in result) {
      return result;
    }
    this.setAuthCookies(res, result);
    return result;
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('mfa/verify')
  @ApiOperation({ summary: 'Conclui o login validando o código MFA' })
  async verifyMfa(
    @Body() dto: VerifyMfaDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthTokens> {
    const tokens = await this.authService.completeMfaLogin(dto.mfaToken, dto.code);
    this.setAuthCookies(res, tokens);
    return tokens;
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('forgot-password')
  @ApiOperation({ summary: 'Solicita link de redefinição de senha por e-mail' })
  async forgotPassword(@Body() dto: ForgotPasswordDto): Promise<{ success: true }> {
    await this.authService.requestPasswordReset(dto.email);
    return { success: true };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('reset-password')
  @ApiOperation({ summary: 'Redefine a senha usando o token do e-mail' })
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<{ success: true }> {
    await this.authService.resetPassword(dto.token, dto.newPassword);
    return { success: true };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('verify-email')
  @ApiOperation({ summary: 'Confirma o e-mail usando o token do link' })
  async verifyEmail(@Body() dto: VerifyEmailDto): Promise<{ success: true }> {
    await this.authService.verifyEmail(dto.token);
    return { success: true };
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @Post('resend-verification')
  @ApiOperation({ summary: 'Reenvia o e-mail de verificação' })
  async resendVerification(@Body() dto: ResendVerificationDto): Promise<{ success: true }> {
    const user = await this.authService.findUserByEmail(dto.email);
    if (user && !user.emailVerifiedAt) {
      await this.authService.sendEmailVerification(user.id);
    }
    return { success: true };
  }

  @ApiBearerAuth()
  @Post('mfa/setup')
  @ApiOperation({ summary: 'Inicia a configuração do MFA (segredo + códigos de recuperação)' })
  async setupMfa(@CurrentUser() user: RequestUser) {
    return this.authService.setupMfa(user.id);
  }

  @ApiBearerAuth()
  @Post('mfa/enable')
  @ApiOperation({ summary: 'Ativa o MFA após validar o código TOTP' })
  async enableMfa(
    @CurrentUser() user: RequestUser,
    @Body() dto: EnableMfaDto,
  ): Promise<{ success: true }> {
    await this.authService.enableMfa(user.id, dto.code);
    return { success: true };
  }

  @ApiBearerAuth()
  @Post('mfa/disable')
  @ApiOperation({ summary: 'Desativa o MFA (senha + código)' })
  async disableMfa(
    @CurrentUser() user: RequestUser,
    @Body() dto: DisableMfaDto,
  ): Promise<{ success: true }> {
    await this.authService.disableMfa(user.id, dto.password, dto.code);
    return { success: true };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @UseGuards(JwtRefreshGuard)
  @Post('refresh')
  @ApiOperation({ summary: 'Rotaciona o refresh token e emite novos tokens' })
  async refresh(
    @Req() req: Request,
    @Body() dto: RefreshTokenDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthTokens> {
    const user = req.user as RequestUser;
    const presentedToken =
      (req.cookies?.[REFRESH_TOKEN_COOKIE] as string | undefined) ?? dto.refreshToken;
    const tokens = await this.authService.refresh(user.id, presentedToken ?? '');
    this.setAuthCookies(res, tokens);
    return tokens;
  }

  @ApiBearerAuth()
  @Get('me')
  @BypassTenantAccess()
  @ApiOperation({ summary: 'Perfil do usuário autenticado' })
  me(@CurrentUser() user: RequestUser): RequestUser {
    return user;
  }

  @ApiBearerAuth()
  @Post('logout')
  @ApiOperation({ summary: 'Revoga o refresh token atual' })
  async logout(
    @CurrentUser() user: RequestUser,
    @Body() dto: RefreshTokenDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ success: true }> {
    const presentedToken =
      (req.cookies?.[REFRESH_TOKEN_COOKIE] as string | undefined) ?? dto.refreshToken;
    await this.authService.logout(user.id, presentedToken);
    this.clearAuthCookies(res);
    return { success: true };
  }
}
