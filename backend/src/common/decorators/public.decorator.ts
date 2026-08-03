import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marca uma rota como pública (dispensa autenticação JWT).
 * Ex.: login, refresh, register.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
