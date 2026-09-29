import { SessionStatus } from '@prisma/client';
import { WhatsAppClientManager } from '../../src/modules/whatsapp/whatsapp-client.manager';

/**
 * Regressão: o evento `ready` do whatsapp-web.js às vezes não dispara mesmo
 * com a sessão funcional. Sem a sondagem, o status ficava preso em
 * CONNECTING e o watchdog destruía um cliente saudável (cards falhando com
 * "Cannot read properties of undefined (reading 'getChat')").
 */

const TENANT = 'tenant-1';

function buildManager() {
  const prisma = {
    whatsAppSession: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({}),
      upsert: jest.fn(),
    },
  };
  const manager = new WhatsAppClientManager(
    prisma as never,
    {} as never,
    {} as never,
  );
  return { manager, prisma };
}

function fakeClient(usable: boolean) {
  return {
    pupPage: {
      isClosed: () => false,
      evaluate: jest.fn().mockResolvedValue(usable),
    },
    getChatById: jest.fn(),
    destroy: jest.fn().mockResolvedValue(undefined),
  };
}

type ManagerInternals = {
  clients: Map<string, unknown>;
  clientAttemptAt: Map<string, number>;
  lastRecoveryAt: Map<string, number>;
  isClientUsable: (client: unknown) => Promise<boolean>;
  watchConnectingClients: () => Promise<void>;
};

function internals(manager: WhatsAppClientManager): ManagerInternals {
  return manager as unknown as ManagerInternals;
}

function putClient(manager: WhatsAppClientManager, client: unknown): void {
  internals(manager).clients.set(TENANT, client);
}

describe('WhatsAppClientManager', () => {
  it('sonda a sessão e marca CONNECTED quando o cliente está utilizável', async () => {
    const { manager, prisma } = buildManager();
    prisma.whatsAppSession.findUnique.mockResolvedValue({
      status: SessionStatus.CONNECTING,
    });
    putClient(manager, fakeClient(true));

    const { status } = await manager.sessionStatus(TENANT);

    expect(status).toBe(SessionStatus.CONNECTED);
    expect(prisma.whatsAppSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { clientId: `tenant-${TENANT}` },
        data: expect.objectContaining({ status: SessionStatus.CONNECTED }),
      }),
    );
  });

  it('mantém CONNECTING quando a página ainda não injetou os utilitários', async () => {
    const { manager, prisma } = buildManager();
    prisma.whatsAppSession.findUnique.mockResolvedValue({
      status: SessionStatus.CONNECTING,
    });
    putClient(manager, fakeClient(false));

    const { status } = await manager.sessionStatus(TENANT);

    expect(status).toBe(SessionStatus.CONNECTING);
    expect(prisma.whatsAppSession.updateMany).not.toHaveBeenCalled();
  });

  it('reporta DISCONNECTED quando não há sessão registrada', async () => {
    const { manager, prisma } = buildManager();
    prisma.whatsAppSession.findUnique.mockResolvedValue(null);

    const { status } = await manager.sessionStatus(TENANT);

    expect(status).toBe(SessionStatus.DISCONNECTED);
  });

  it('isClientUsable rejeita página ausente, fechada ou sem injeção', async () => {
    const { manager } = buildManager();
    const probe = internals(manager).isClientUsable;

    await expect(probe({})).resolves.toBe(false);
    await expect(
      probe({ pupPage: { isClosed: () => true, evaluate: jest.fn() } }),
    ).resolves.toBe(false);
    await expect(
      probe({ pupPage: { isClosed: () => false, evaluate: jest.fn().mockResolvedValue(false) } }),
    ).resolves.toBe(false);
    await expect(
      probe({ pupPage: { isClosed: () => false, evaluate: jest.fn().mockResolvedValue(true) } }),
    ).resolves.toBe(true);
  });

  it('watchdog NÃO recria um cliente utilizável preso em CONNECTING', async () => {
    const { manager, prisma } = buildManager();
    prisma.whatsAppSession.findUnique.mockResolvedValue({
      status: SessionStatus.CONNECTING,
    });
    putClient(manager, fakeClient(true));
    internals(manager).clientAttemptAt.set(TENANT, Date.now() - 130_000);
    const connect = jest
      .spyOn(manager, 'connect')
      .mockResolvedValue({ status: SessionStatus.CONNECTED });

    await internals(manager).watchConnectingClients();

    expect(connect).not.toHaveBeenCalled();
    expect(prisma.whatsAppSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: SessionStatus.CONNECTED }),
      }),
    );
    expect(internals(manager).clientAttemptAt.has(TENANT)).toBe(false);
  });

  it('watchdog recria o cliente quando ele realmente não responde', async () => {
    const { manager, prisma } = buildManager();
    prisma.whatsAppSession.findUnique.mockResolvedValue({
      status: SessionStatus.CONNECTING,
    });
    putClient(manager, fakeClient(false));
    internals(manager).clientAttemptAt.set(TENANT, Date.now() - 130_000);
    const connect = jest
      .spyOn(manager, 'connect')
      .mockResolvedValue({ status: SessionStatus.CONNECTING });

    await internals(manager).watchConnectingClients();

    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('sendToGroup rejeita quando não há cliente (nunca finge sucesso)', async () => {
    const { manager } = buildManager();

    await expect(
      manager.sendToGroup(TENANT, '123@g.us', 'texto'),
    ).rejects.toThrow(/Cliente WhatsApp inexistente/);
  });

  it(
    'sendToGroup rejeita quando a página não está pronta em vez de resolver',
    async () => {
      const { manager } = buildManager();
      putClient(manager, fakeClient(false));
      // Evita recriar o cliente real (browser) no fim das tentativas.
      internals(manager).lastRecoveryAt.set(TENANT, Date.now());

      await expect(
        manager.sendToGroup(TENANT, '123@g.us', 'texto'),
      ).rejects.toThrow(/não está pronta/);
    },
    15000,
  );
});
