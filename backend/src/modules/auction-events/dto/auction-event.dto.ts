import { IsInt, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';

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
}