import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { RequestUser } from '../types/auth.types';

/**
 * Extrai o usuário autenticado da requisição.
 * Uso: @CurrentUser() user: RequestUser  ou  @CurrentUser('tenantId') tenantId: string
 */
export const CurrentUser = createParamDecorator(
  (data: keyof RequestUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<Request & { user: RequestUser }>();
    const user = request.user;
    return data ? user?.[data] : user;
  },
);
