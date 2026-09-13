import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsNumber, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';

export class CreateAuctionEventDto {
  @IsString()
  @Length(1, 200, { message: 'O nome do leilão deve ter entre 1 e 200 caracteres.' })
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000, { message: 'A descrição deve ter no máximo 1000 caracteres.' })
  description?: string;

  @IsOptional()
  @IsString()
  groupId?: string;

  @IsOptional()
  @IsInt({ message: 'O intervalo do status deve ser um número inteiro de minutos.' })
  @Min(0, { message: 'O intervalo mínimo é 0 (somente sob demanda).' })
  @Max(1440, { message: 'O intervalo máximo é 1440 minutos.' })
  periodicStatusMinutes?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'O incremento mínimo deve ser um número.' })
  @Min(0, { message: 'O incremento mínimo não pode ser negativo.' })
  minBidStep?: number;

  @IsOptional()
  @IsDateString({}, { message: 'O início agendado deve ser uma data válida.' })
  scheduledStartAt?: string;

  @IsOptional()
  @IsDateString({}, { message: 'O término agendado deve ser uma data válida.' })
  scheduledEndAt?: string;
}

export class UpdateAuctionEventDto {
  @IsOptional()
  @IsString()
  @Length(1, 200, { message: 'O nome do leilão deve ter entre 1 e 200 caracteres.' })
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000, { message: 'A descrição deve ter no máximo 1000 caracteres.' })
  description?: string;

  @IsOptional()
  @IsString()
  groupId?: string;

  @IsOptional()
  @IsInt({ message: 'O intervalo do status deve ser um número inteiro de minutos.' })
  @Min(0, { message: 'O intervalo mínimo é 0 (somente sob demanda).' })
  @Max(1440, { message: 'O intervalo máximo é 24 horas.' })
  periodicStatusMinutes?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'O incremento mínimo deve ser um número.' })
  @Min(0, { message: 'O incremento mínimo não pode ser negativo.' })
  minBidStep?: number;

  @IsOptional()
  @IsDateString({}, { message: 'O início agendado deve ser uma data válida.' })
  scheduledStartAt?: string;

  @IsOptional()
  @IsDateString({}, { message: 'O término agendado deve ser uma data válida.' })
  scheduledEndAt?: string;
}

/**
 * Agenda o encerramento de um item da lista após o início do leilão.
 * `endsAt` null (ou ausente) remove o agendamento.
 */
export class ScheduleListItemEndDto {
  @IsOptional()
  @IsDateString({}, { message: 'A data de encerramento deve ser válida.' })
  endsAt?: string | null;
}