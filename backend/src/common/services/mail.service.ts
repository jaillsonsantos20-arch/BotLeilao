import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { Transporter } from 'nodemailer';
import { AppConfig } from '../config/configuration';

interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * Envio de e-mails transacionais.
 *
 * Se o SMTP não estiver configurado (desenvolvimento), os e-mails são
 * logados no console para permitir testar os fluxos (reset/verificação)
 * sem infraestrutura de e-mail.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter | null;
  private readonly from: string;
  private readonly enabled: boolean;

  constructor(configService: ConfigService<AppConfig>) {
    const mail = configService.get('mail', { infer: true })!;
    this.from = mail.from;
    this.enabled = Boolean(mail.host && mail.user);

    if (this.enabled) {
      this.transporter = nodemailer.createTransport({
        host: mail.host,
        port: mail.port,
        secure: mail.secure,
        auth: { user: mail.user, pass: mail.pass },
      });
    } else {
      this.transporter = null;
    }
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  async send(message: MailMessage): Promise<void> {
    if (this.enabled && this.transporter) {
      try {
        await this.transporter.sendMail({
          from: this.from,
          to: message.to,
          subject: message.subject,
          text: message.text,
          html: message.html,
        });
        return;
      } catch (error) {
        this.logger.error(
          `Falha ao enviar e-mail para ${message.to}: ${(error as Error).message}`,
        );
        throw error;
      }
    }

    this.logger.warn(`[MAIL-DEV] ${message.subject} -> ${message.to}\n${message.text}`);
  }
}