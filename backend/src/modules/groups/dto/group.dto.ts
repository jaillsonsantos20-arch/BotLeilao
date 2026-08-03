import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

export class CreateGroupDto {
  @IsString()
  @Length(2, 120, { message: 'O nome do grupo deve ter entre 2 e 120 caracteres.' })
  name: string;

  @IsString()
  @Length(1, 100, { message: 'O id do grupo no WhatsApp é obrigatório.' })
  whatsappGroupId: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  description?: string;
}

export class UpdateGroupDto {
  @IsOptional()
  @IsString()
  @Length(2, 120)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  description?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ListGroupsQueryDto {
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
