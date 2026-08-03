import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Guard que dispara a estratégia "jwt-refresh".
 */
@Injectable()
export class JwtRefreshGuard extends AuthGuard('jwt-refresh') {}
