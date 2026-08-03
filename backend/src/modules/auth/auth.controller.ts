import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RequestUser } from '../../common/types/auth.types';
import { AuthService, AuthTokens } from './auth.service';
import { LoginDto, RefreshTokenDto, RegisterDto } from './dto/auth.dto';
import { JwtRefreshGuard } from './guards/jwt-refresh.guard';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('register')
  @ApiOperation({ summary: 'Registra um novo cliente (tenant + usuário admin)' })
  register(@Body() dto: RegisterDto): Promise<AuthTokens> {
    return this.authService.register(dto);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('login')
  @ApiOperation({ summary: 'Autentica um usuário e retorna os tokens' })
  login(@Body() dto: LoginDto): Promise<AuthTokens> {
    return this.authService.login(dto);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @UseGuards(JwtRefreshGuard)
  @Post('refresh')
  @ApiOperation({ summary: 'Rotaciona o refresh token e emite novos tokens' })
  refresh(
    @Req() req: Request,
    @Body() dto: RefreshTokenDto,
  ): Promise<AuthTokens> {
    const user = req.user as RequestUser;
    return this.authService.refresh(user.id, dto.refreshToken);
  }

  @ApiBearerAuth()
  @Get('me')
  @ApiOperation({ summary: 'Perfil do usuário autenticado' })
  me(@CurrentUser() user: RequestUser): RequestUser {
    return user;
  }

  @ApiBearerAuth()
  @Post('logout')
  @ApiOperation({ summary: 'Revoga o refresh token atual' })
  logout(
    @CurrentUser() user: RequestUser,
    @Body() dto: RefreshTokenDto,
  ): Promise<{ success: true }> {
    return this.authService.logout(user.id, dto.refreshToken).then(() => ({ success: true }));
  }
}
