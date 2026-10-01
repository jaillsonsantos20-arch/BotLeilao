import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** Máximo de variações (sinônimos) por item — limite de segurança do painel. */
export const ITEM_ALIAS_MAX_PER_ITEM = 30;

export class CreateItemDto {
  @IsOptional()
  @IsString()
  auctionEventId?: string;

  @IsString()
  @Length(1, 200, { message: 'O nome do item deve ter entre 1 e 200 caracteres.' })
  name: string;

  @IsOptional()
  @IsString()
  @Length(1, 1000, { message: 'A descrição deve ter no máximo 1000 caracteres.' })
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'A URL da imagem deve ter no máximo 500 caracteres.' })
  imageUrl?: string;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'O valor inicial deve ser um número.' })
  @Min(0.01, { message: 'O valor inicial deve ser maior que zero.' })
  initialValue: number;

  @IsOptional()
  @IsInt({ message: 'O nº do item deve ser um número inteiro.' })
  @Min(1, { message: 'O nº do item deve ser maior que zero.' })
  number?: number | null;

  @IsOptional()
  @IsInt({ message: 'O nº do item deve ser um número inteiro.' })
  @Min(1, { message: 'O nº do item deve ser maior que zero.' })
  order?: number;

  @IsOptional()
  @IsInt({ message: 'O tempo do leilão deve ser um número inteiro de minutos.' })
  @Min(1, { message: 'A duração mínima é de 1 minuto.' })
  @Max(1440, { message: 'A duração máxima é de 1440 minutos (24 horas).' })
  durationMinutes?: number | null;

  /**
   * Variações/sinônimos do item ("boi", "gado", "novilho"): participantes
   * podem usar qualquer uma para indicar este item. Nunca cria item novo.
   */
  @IsOptional()
  @IsArray({ message: 'As variações devem ser uma lista de textos.' })
  @ArrayMaxSize(ITEM_ALIAS_MAX_PER_ITEM, {
    message: `Máximo de ${ITEM_ALIAS_MAX_PER_ITEM} variações por item.`,
  })
  @IsString({ each: true, message: 'Cada variação deve ser um texto.' })
  @Length(1, 60, {
    each: true,
    message: 'Cada variação deve ter entre 1 e 60 caracteres.',
  })
  aliases?: string[];
}

export class ListItemsQueryDto {
  @IsOptional()
  @IsString()
  auctionEventId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class StartItemAuctionDto {
  @IsString()
  groupId: string;

  @IsOptional()
  @IsInt({ message: 'O tempo do leilão deve ser um número inteiro de minutos.' })
  @Min(1, { message: 'A duração mínima é de 1 minuto.' })
  @Max(1440, { message: 'A duração máxima é de 1440 minutos (24 horas).' })
  durationMinutes?: number;
}

export class UpdateItemDto {
  @IsOptional()
  @IsString()
  @Length(1, 200, { message: 'O nome do item deve ter entre 1 e 200 caracteres.' })
  name?: string;

  @IsOptional()
  @IsString()
  @Length(1, 1000, { message: 'A descrição deve ter no máximo 1000 caracteres.' })
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'A URL da imagem deve ter no máximo 500 caracteres.' })
  imageUrl?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'O valor inicial deve ser um número.' })
  @Min(0.01, { message: 'O valor inicial deve ser maior que zero.' })
  initialValue?: number;

  @IsOptional()
  @IsInt({ message: 'O nº do item deve ser um número inteiro.' })
  @Min(1, { message: 'O nº do item deve ser maior que zero.' })
  number?: number | null;

  @IsOptional()
  @IsInt({ message: 'O nº do item deve ser um número inteiro.' })
  @Min(1, { message: 'O nº do item deve ser maior que zero.' })
  order?: number;

  @IsOptional()
  @IsInt({ message: 'O tempo do leilão deve ser um número inteiro de minutos.' })
  @Min(0, { message: 'A duração mínima é de 0 minutos.' })
  @Max(1440, { message: 'A duração máxima é de 1440 minutos (24 horas).' })
  durationMinutes?: number | null;
}

/** Criação de uma variação (sinônimo) de item. */
export class CreateItemAliasDto {
  @IsString({ message: 'A variação deve ser um texto.' })
  @Length(1, 60, {
    message: 'A variação deve ter entre 1 e 60 caracteres.',
  })
  value: string;
}

/** Edição de uma variação: troca o texto e/ou ativa/desativa. */
export class UpdateItemAliasDto {
  @IsOptional()
  @IsString({ message: 'A variação deve ser um texto.' })
  @Length(1, 60, {
    message: 'A variação deve ter entre 1 e 60 caracteres.',
  })
  value?: string;

  @IsOptional()
  @IsBoolean({ message: 'O campo active deve ser true ou false.' })
  active?: boolean;
}
