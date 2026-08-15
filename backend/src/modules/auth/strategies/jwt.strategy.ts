import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';
import { AppConfig } from '../../../common/config/configuration';
import { PrismaService } from '../../../common/database/prisma.service';
import { JwtPayload, RequestUser } from '../../../common/types/auth.types';

export const ACCESS_TOKEN_COOKIE = 'botleilao.accessToken';

/**
 * Estratégia "jwt": valida o access token e carrega o usuário atualizado do banco.
 * Se o usuário foi desativado ou removido, a requisição é rejeitada.
 *
 * Aceita o token do cookie HttpOnly (navegador) OU do header Authorization
 * (clientes API/tests) — a migração mantém ambos por compatibilidade.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    configService: ConfigService<AppConfig>,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (req: Request) => {
          const cookie = req.cookies?.[ACCESS_TOKEN_COOKIE];
          return typeof cookie === 'string' && cookie.length > 0 ? cookie : null;
        },
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      secretOrKey: configService.get('jwt', { infer: true })!.secret,
    });
  }

  async validate(payload: JwtPayload): Promise<RequestUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        tenantId: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        emailVerifiedAt: true,
        totpEnabled: true,
      },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Usuário inativo ou inexistente.');
    }

    return user;
  }
}
