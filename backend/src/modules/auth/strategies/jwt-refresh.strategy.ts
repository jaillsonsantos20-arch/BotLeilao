import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-jwt';
import { Request } from 'express';
import { AppConfig } from '../../../common/config/configuration';
import { JwtRefreshPayload } from '../../../common/types/auth.types';

/**
 * Estratégia "jwt-refresh": valida o refresh token enviado no corpo da requisição.
 * A presença do token na carga garante que apenas quem possui o refresh token
 * consiga gerar novos pares de tokens.
 */
@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(Strategy, 'jwt-refresh') {
  constructor(configService: ConfigService<AppConfig>) {
    super({
      jwtFromRequest: (req: Request) => req.body?.refreshToken ?? null,
      ignoreExpiration: false,
      passReqToCallback: true,
      secretOrKey: configService.get('jwt', { infer: true })!.refreshSecret,
    });
  }

  validate(_req: Request, payload: JwtRefreshPayload): JwtRefreshPayload {
    if (!payload.jti) {
      throw new UnauthorizedException('Refresh token inválido.');
    }
    return payload;
  }
}
