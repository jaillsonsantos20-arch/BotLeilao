import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request, Response } from 'express';

/**
 * Converte erros conhecidos do Prisma em respostas HTTP semânticas.
 *
 *  - P2002 (unique constraint)  -> 409 Conflict
 *  - P2025 (registro inexistente) -> 404 Not Found
 *  - P2003 (foreign key)       -> 400 Bad Request
 *  - P2014 / P2015             -> 400 Bad Request
 *  - demais                    -> rethrow (tratados pelo AllExceptionsFilter)
 */
/* eslint-disable no-useless-assignment -- valores padrão sobrescritos nas cases */
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaClientExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PrismaClientExceptionFilter.name);

  catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let statusCode = HttpStatus.BAD_REQUEST;
    let message = 'Erro ao acessar o banco de dados';

    switch (exception.code) {
      case 'P2002':
        statusCode = HttpStatus.CONFLICT;
        message = `Registro duplicado: ${this.targetDescription(exception)} já existe.`;
        break;
      case 'P2025':
        statusCode = HttpStatus.NOT_FOUND;
        message = 'Registro não encontrado.';
        break;
      case 'P2003':
        statusCode = HttpStatus.BAD_REQUEST;
        message = 'Operação inválida: registro relacionado não existe.';
        break;
      case 'P2014':
        statusCode = HttpStatus.BAD_REQUEST;
        message = 'Operação violaria uma restrição de relacionamento.';
        break;
      default:
        this.logger.warn(`Erro Prisma não mapeado (${exception.code}): ${exception.message}`);
        response.status(HttpStatus.BAD_REQUEST).json({
          statusCode: HttpStatus.BAD_REQUEST,
          message: `Erro de banco de dados (${exception.code}).`,
          error: 'Database Error',
          path: request.url,
          timestamp: new Date().toISOString(),
        });
        return;
    }

    response.status(statusCode).json({
      statusCode,
      message,
      error: 'Conflict',
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }

  private targetDescription(exception: Prisma.PrismaClientKnownRequestError): string {
    const target = (exception.meta?.target as string[] | undefined)?.join(', ');
    return target ?? 'recurso';
  }
}
