import { IsEmail, IsNotEmpty, IsOptional, IsString, Length } from 'class-validator';

/**
 * Login de usuário existente.
 */
export class LoginDto {
  @IsEmail({}, { message: 'E-mail inválido.' })
  email: string;

  @IsString()
  @IsNotEmpty({ message: 'A senha é obrigatória.' })
  password: string;
}

/**
 * Registro de novo cliente (tenant + primeiro usuário).
 */
export class RegisterDto {
  @IsString()
  @Length(2, 120, { message: 'O nome deve ter entre 2 e 120 caracteres.' })
  name: string;

  @IsEmail({}, { message: 'E-mail inválido.' })
  email: string;

  @IsString()
  @Length(8, 72, { message: 'A senha deve ter entre 8 e 72 caracteres.' })
  password: string;

  @IsString()
  @Length(2, 120, { message: 'O nome da empresa deve ter entre 2 e 120 caracteres.' })
  companyName: string;

  @IsOptional()
  @IsString()
  cnpj?: string;
}

/**
 * Rotação do refresh token.
 */
export class RefreshTokenDto {
  @IsString()
  @IsNotEmpty({ message: 'O refresh token é obrigatório.' })
  refreshToken: string;
}
