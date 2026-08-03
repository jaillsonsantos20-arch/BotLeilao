import { Injectable } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Parâmetros comuns de paginação para endpoints que retornam listas.
 */
@Injectable()
export class PaginationDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page deve ser um número inteiro' })
  @Min(1, { message: 'page deve ser >= 1' })
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit deve ser um número inteiro' })
  @Min(1, { message: 'limit deve ser >= 1' })
  @Max(100, { message: 'limit deve ser <= 100' })
  limit: number = 20;

  get offset(): number {
    return (this.page - 1) * this.limit;
  }
}

export interface PaginatedResult<T> {
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export function buildPaginatedResult<T>(
  data: T[],
  total: number,
  page: number,
  limit: number,
): PaginatedResult<T> {
  return {
    data,
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}
