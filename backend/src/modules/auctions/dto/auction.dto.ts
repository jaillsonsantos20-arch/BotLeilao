import { AuctionStatus, PaymentStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

export class StartAuctionDto {
  @IsString()
  groupId: string;

  @IsString()
  @Length(1, 200, { message: 'O nome do produto deve ter entre 1 e 200 caracteres.' })
  productName: string;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'O valor inicial deve ser um número.' })
  @Min(0.01, { message: 'O valor inicial deve ser maior que zero.' })
  initialValue: number;

  @IsInt({ message: 'O tempo do leilão deve ser um número inteiro de segundos.' })
  @Min(10, { message: 'A duração mínima é de 10 segundos.' })
  @Max(86400, { message: 'A duração máxima é de 24 horas.' })
  durationSeconds: number;
}

export class PlaceBidDto {
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'O valor do lance deve ser um número.' })
  @Min(0.01, { message: 'O lance deve ser maior que zero.' })
  amount: number;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  participantName?: string;
}

export class ListAuctionsQueryDto {
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

  @IsOptional()
  @IsEnum(AuctionStatus)
  status?: AuctionStatus;

  @IsOptional()
  @IsString()
  groupId?: string;
}

export class UpdatePaymentStatusDto {
  @IsEnum(PaymentStatus)
  status: PaymentStatus;
}

export class UpdateAuctionDto {
  @IsOptional()
  @IsString()
  @Length(1, 200, { message: 'O nome do produto deve ter entre 1 e 200 caracteres.' })
  productName?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'O valor inicial deve ser um número.' })
  @Min(0.01, { message: 'O valor inicial deve ser maior que zero.' })
  initialValue?: number;

  @IsOptional()
  @IsInt({ message: 'A duração deve ser um número inteiro de segundos.' })
  @Min(10, { message: 'A duração mínima é de 10 segundos.' })
  @Max(86400, { message: 'A duração máxima é de 24 horas.' })
  durationSeconds?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'O incremento mínimo deve ser um número.' })
  @Min(0, { message: 'O incremento mínimo deve ser positivo.' })
  minBidStep?: number | null;
}

export class UpdateBidDto {
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'O valor do lance deve ser um número.' })
  @Min(0.01, { message: 'O lance deve ser maior que zero.' })
  amount: number;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  participantName?: string;

  @IsOptional()
  @IsString()
  @Length(1, 32)
  participantPhone?: string;
}
