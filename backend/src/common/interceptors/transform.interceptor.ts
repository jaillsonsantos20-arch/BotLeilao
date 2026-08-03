import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
  timestamp: string;
}

/**
 * Padroniza toda resposta de sucesso no formato:
 *   { success: true, data, meta?, timestamp }
 */
@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, ApiSuccess<T>> {
  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<ApiSuccess<T>> {
    return next.handle().pipe(
      map((data) => {
        const hasPagination =
          data && typeof data === 'object' && 'data' in data && 'meta' in data;

        let payload: T;
        let meta: Record<string, unknown> | undefined;

        if (hasPagination) {
          const paginated = data as unknown as { data: T; meta: Record<string, unknown> };
          payload = paginated.data;
          meta = paginated.meta;
        } else {
          payload = data;
        }

        return {
          success: true,
          data: payload,
          ...(meta ? { meta } : {}),
          timestamp: new Date().toISOString(),
        } as ApiSuccess<T>;
      }),
    );
  }
}
