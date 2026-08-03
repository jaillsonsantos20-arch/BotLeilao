import { Type } from 'class-transformer';
import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

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
  @IsInt({ message: 'O tempo do leilão deve ser um número inteiro de segundos.' })
  @Min(10, { message: 'A duração mínima é de 10 segundos.' })
  @Max(86400, { message: 'A duração máxima é de 24 horas.' })
  durationSeconds?: number;
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
  @IsInt({ message: 'O tempo do leilão deve ser um número inteiro de segundos.' })
  @Min(10, { message: 'A duração mínima é de 10 segundos.' })
  @Max(86400, { message: 'A duração máxima é de 24 horas.' })
  durationSeconds?: number;
}
