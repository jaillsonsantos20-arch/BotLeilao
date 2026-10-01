import { Message } from 'whatsapp-web.js';
import { WhatsAppClientManager } from '../../src/modules/whatsapp/whatsapp-client.manager';
import { BidMessageInput } from '../../src/modules/whatsapp/whatsapp.types';

/**
 * Transporte de mensagens: idempotência (reentrega do WhatsApp), roteamento de
 * texto e conversão de áudio em texto ANTES do pipeline único de interpretação.
 */

type Internals = {
  handleIncomingMessage: (tenantId: string, message: Message) => Promise<void>;
};

function build(stt?: { isEnabled: () => boolean; friendlyMessage: (e?: string) => string; transcribe: jest.Mock }) {
  const route = jest.fn().mockResolvedValue(undefined);
  const speechToText = stt ?? {
    isEnabled: () => false,
    friendlyMessage: () => '🤖 Não consigo processar áudio. Digite o seu lance (01 300).',
    transcribe: jest.fn(),
  };
  const manager = new WhatsAppClientManager(
    {} as never,
    { route } as never,
    {} as never,
    speechToText as never,
  );
  return { manager: manager as unknown as Internals, route, speechToText };
}

function groupMessage(overrides: Partial<Record<string, unknown>> = {}): Message {
  const sendMessage = jest.fn();
  const chat = {
    isGroup: true,
    id: { _serialized: 'group-1' },
    name: 'Grupo Teste',
    participants: [],
    sendMessage,
  };
  return {
    id: { _serialized: 'msg-1' },
    from: '5511999999999@c.us',
    author: '5511999999999@c.us',
    fromMe: false,
    type: 'chat',
    body: 'bom dia',
    hasQuotedMsg: false,
    getChat: async () => chat,
    getContact: async () => null,
    ...overrides,
    __chat: chat,
  } as unknown as Message & { __chat: { sendMessage: jest.Mock } };
}

describe('WhatsAppClientManager — idempotência', () => {
  it('a mesma mensagem reentregue só processa uma vez', async () => {
    const { manager, route } = build();
    const message = groupMessage();

    await manager.handleIncomingMessage('tenant-1', message);
    await manager.handleIncomingMessage('tenant-1', message);

    expect(route).toHaveBeenCalledTimes(1);
  });

  it('mensagens diferentes seguem processadas', async () => {
    const { manager, route } = build();

    await manager.handleIncomingMessage('tenant-1', groupMessage());
    await manager.handleIncomingMessage(
      'tenant-1',
      groupMessage({ id: { _serialized: 'msg-2' } }),
    );

    expect(route).toHaveBeenCalledTimes(2);
  });
});

describe('WhatsAppClientManager — texto', () => {
  it('entrega BidMessageInput com origem TEXT para o pipeline', async () => {
    const { manager, route } = build();
    const message = groupMessage({ body: '01 300' });

    await manager.handleIncomingMessage('tenant-1', message);

    expect(route).toHaveBeenCalledTimes(1);
    const [, routedMessage, replyContext, input] = route.mock.calls[0] as [
      unknown,
      Message,
      undefined,
      BidMessageInput,
    ];
    expect(routedMessage).toBe(message);
    expect(replyContext).toBeUndefined();
    expect(input).toEqual({ text: '01 300', source: 'TEXT', messageId: 'msg-1' });
  });
});

describe('WhatsAppClientManager — áudio (Speech-to-Text)', () => {
  it('com STT desativado explica ao participante e NÃO roteia', async () => {
    const { manager, route } = build();
    const message = groupMessage({ type: 'ptt', body: '' });

    await manager.handleIncomingMessage('tenant-1', message);

    expect(route).not.toHaveBeenCalled();
    const sendMessage = (message as unknown as { __chat: { sendMessage: jest.Mock } }).__chat
      .sendMessage;
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][0]).toContain('Digite o seu lance');
  });

  it('com STT ativo transcreve e roteia com origem AUDIO', async () => {
    const transcribe = jest.fn().mockResolvedValue({
      ok: true,
      text: 'dou 50 no bolo',
      quality: 0.9,
      provider: 'openai-compatible',
      durationMs: 120,
    });
    const { manager, route } = build({
      isEnabled: () => true,
      friendlyMessage: () => 'erro de áudio',
      transcribe,
    });
    const message = groupMessage({
      type: 'ptt',
      body: '',
      mimetype: 'audio/ogg',
      downloadMedia: async () => ({ data: 'QUJDRA==', mimetype: 'audio/ogg' }),
      duration: '7',
    });

    await manager.handleIncomingMessage('tenant-1', message);

    expect(transcribe).toHaveBeenCalledWith(
      expect.objectContaining({ mimeType: 'audio/ogg', durationSeconds: 7 }),
    );
    expect(route).toHaveBeenCalledTimes(1);
    const input = route.mock.calls[0][3] as BidMessageInput;
    expect(input).toEqual({
      text: 'dou 50 no bolo',
      source: 'AUDIO',
      transcription: 'dou 50 no bolo',
      messageId: 'msg-1',
      transcriptionQuality: 0.9,
    });
  });

  it('falha na transcrição vira mensagem amigável (nunca derruba o fluxo)', async () => {
    const { manager, route } = build({
      isEnabled: () => true,
      friendlyMessage: () => '🎤 Não entendi o áudio.',
      transcribe: jest.fn().mockResolvedValue({ ok: false, error: 'provider_error' }),
    });
    const message = groupMessage({
      type: 'ptt',
      body: '',
      downloadMedia: async () => ({ data: 'QUJDRA==', mimetype: 'audio/ogg' }),
    });

    await manager.handleIncomingMessage('tenant-1', message);

    expect(route).not.toHaveBeenCalled();
    const sendMessage = (message as unknown as { __chat: { sendMessage: jest.Mock } }).__chat
      .sendMessage;
    expect(sendMessage.mock.calls[0][0]).toContain('Não entendi o áudio');
  });

  it('áudio indisponível também responde sem lançar exceção', async () => {
    const { manager, route } = build({
      isEnabled: () => true,
      friendlyMessage: () => '🎤 Não consegui ler este áudio.',
      transcribe: jest.fn(),
    });
    const message = groupMessage({
      type: 'ptt',
      body: '',
      downloadMedia: async () => undefined,
    });

    await expect(manager.handleIncomingMessage('tenant-1', message)).resolves.toBeUndefined();
    expect(route).not.toHaveBeenCalled();
  });
});
