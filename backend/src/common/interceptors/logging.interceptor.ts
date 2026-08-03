import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Request } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

/**
 * Registra método, rota, status e tempo de cada requisição.
 * Use o `LoggingInterceptor` globalmente em produção (Nest já loga por padrão em dev).
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const startedAt = Date.now();
    const { method, originalUrl } = req;

    return next.handle().pipe(
      tap({
        next: () => {
          const res = context.switchToHttp().getResponse();
          this.logger.log(
            `${method} ${originalUrl} ${res.statusCode} ${Date.now() - startedAt}ms`,
          );
        },
        error: (error: { status?: number; message?: string }) => {
          this.logger.warn(
            `${method} ${originalUrl} ${error.status ?? 500} ${Date.now() - startedAt}ms - ${error.message}`,
          );
        },
      }),
    );
  }
}
