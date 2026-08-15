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

  @IsOptional()
  @IsString()
  planId?: string;
}

/**
 * Rota��o do refresh token. O token pode vir do cookie HttpOnly (navegador)
 * ou do corpo da requisição (clientes API) — por isso é opcional.
 */
export class RefreshTokenDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'O refresh token é obrigatório.' })
  refreshToken?: string;
}

/**
 * Solicitação de redefinição de senha (e-mail).
 */
export class ForgotPasswordDto {
  @IsEmail({}, { message: 'E-mail inválido.' })
  email: string;
}

/**
 * Redefinição de senha com token.
 */
export class ResetPasswordDto {
  @IsString()
  @IsNotEmpty({ message: 'O token é obrigatório.' })
  token: string;

  @IsString()
  @Length(8, 72, { message: 'A senha deve ter entre 8 e 72 caracteres.' })
  newPassword: string;
}

/**
 * Verificação de e-mail com token.
 */
export class VerifyEmailDto {
  @IsString()
  @IsNotEmpty({ message: 'O token é obrigatório.' })
  token: string;
}

/**
 * Reenvio do e-mail de verificação.
 */
export class ResendVerificationDto {
  @IsEmail({}, { message: 'E-mail inválido.' })
  email: string;
}

/**
 * Ativação do MFA/TOTP com código do app autenticador.
 */
export class EnableMfaDto {
  @IsString()
  @IsNotEmpty({ message: 'O código é obrigatório.' })
  code: string;
}

/**
 * Desativação do MFA (senha + código TOTP ou código de recuperação).
 */
export class DisableMfaDto {
  @IsString()
  @IsNotEmpty({ message: 'A senha é obrigatória.' })
  password: string;

  @IsString()
  @IsNotEmpty({ message: 'O código é obrigatório.' })
  code: string;
}

/**
 * Conclusão do login com MFA (ticket + código TOTP/recuperação).
 */
export class VerifyMfaDto {
  @IsString()
  @IsNotEmpty({ message: 'O ticket de MFA é obrigatório.' })
  mfaToken: string;

  @IsString()
  @IsNotEmpty({ message: 'O código é obrigatório.' })
  code: string;
}
