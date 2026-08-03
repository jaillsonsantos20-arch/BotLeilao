import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Request, Response } from 'express';

export interface ApiErrorBody {
  statusCode: number;
  message: string | string[];
  error: string;
  path: string;
  timestamp: string;
}

/**
 * Filtro global de exceções.
 *
 * Garante um corpo de erro padronizado para toda a API e registra
 * erros não esperados no logger para observabilidade.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Erro interno do servidor';
    let error = 'Internal Server Error';

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const body = exception.getResponse();

      if (typeof body === 'string') {
        message = body;
        error = exception.name;
      } else if (typeof body === 'object' && body !== null) {
        const cast = body as Record<string, unknown>;
        message = (cast.message as string | string[]) ?? exception.message;
        error = (cast.error as string) ?? exception.name;
      }
    } else if (exception instanceof Error) {
      message = exception.message;
      error = exception.name;
      this.logger.error(
        `${request.method} ${request.url} -> ${exception.message}`,
        exception.stack,
        AllExceptionsFilter.name,
      );
    }

    const body: ApiErrorBody = {
      statusCode,
      message,
      error,
      path: request.url,
      timestamp: new Date().toISOString(),
    };

    response.status(statusCode).json(body);
  }
}
