import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Request, Response } from 'express';

export interface ApiErrorBody {
  statusCode: number;
  message: string | string[];
  error: string;
  code?: string;
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
    let code: string | undefined;

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
        code = cast.code as string | undefined;
      }
    } else if (exception instanceof Error) {
      const isProduction = process.env.NODE_ENV === 'production';
      // Não vazar mensagens internas (Prisma, provedores, etc.) para o cliente.
      message = isProduction ? 'Erro interno do servidor' : exception.message;
      error = isProduction ? 'Internal Server Error' : exception.name;
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
      ...(code !== undefined ? { code } : {}),
      path: request.url,
      timestamp: new Date().toISOString(),
    };

    response.status(statusCode).json(body);
  }
}
