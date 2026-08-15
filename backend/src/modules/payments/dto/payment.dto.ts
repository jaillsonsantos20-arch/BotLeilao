import { IsOptional, IsString } from 'class-validator';

export class CreatePixPaymentDto {
  @IsOptional()
  @IsString()
  planId?: string;
}