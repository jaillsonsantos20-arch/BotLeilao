import { IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class CreateAuctionEventDto {
  @IsString()
  @Length(1, 200, { message: 'O nome do leilão deve ter entre 1 e 200 caracteres.' })
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000, { message: 'A descrição deve ter no máximo 1000 caracteres.' })
  description?: string;
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
}
