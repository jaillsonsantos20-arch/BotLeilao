import { Injectable } from '@nestjs/common';
import { SessionStatus } from '@prisma/client';
import { WhatsAppClientManager } from './whatsapp-client.manager';

export interface WhatsAppStatus {
  status: SessionStatus;
  qr: string | null;
}

/**
 * Fachada da integração WhatsApp exposta ao painel administrativo.
 */
@Injectable()
export class WhatsAppService {
  constructor(private readonly clientManager: WhatsAppClientManager) {}

  /**
   * Inicia a sessão do WhatsApp do tenant (gera QR Code no terminal).
   */
  async connect(tenantId: string): Promise<WhatsAppStatus> {
    await this.clientManager.connect(tenantId);
    return this.status(tenantId);
  }

  /**
   * Encerra a sessão do WhatsApp do tenant.
   */
  async disconnect(tenantId: string): Promise<void> {
    this.clientManager.clearQr(tenantId);
    await this.clientManager.disconnect(tenantId);
  }

  /**
   * Status atual da sessão + QR Code pendente (se houver).
   */
  async status(tenantId: string): Promise<WhatsAppStatus> {
    const { status } = await this.clientManager.sessionStatus(tenantId);
    const qr = this.clientManager.getLatestQr(tenantId);
    return { status, qr };
  }
}
