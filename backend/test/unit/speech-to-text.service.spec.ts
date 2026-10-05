import { SpeechToTextService } from '../../src/modules/whatsapp/speech-to-text.service';

type Config = Record<string, unknown>;

function build(stt: Config): SpeechToTextService {
  const config = {
    get: (key: string) => (key === 'speechToText' ? stt : undefined),
  } as unknown as ConstructorParameters<typeof SpeechToTextService>[0];
  return new SpeechToTextService(config);
}

const fullConfig = {
  provider: 'openai',
  apiKey: 'sk-test',
  baseUrl: 'https://api.example.com/v1',
  model: 'whisper-1',
  language: 'pt',
  timeoutMs: 5000,
  maxAudioMb: 1,
  maxDurationSeconds: 30,
};

const audio = (bytes = 1024, mimeType = 'audio/ogg') => ({
  buffer: Buffer.alloc(bytes, 1),
  mimeType,
  durationSeconds: 5,
});

describe('SpeechToTextService — configuração', () => {
  it('sem API key o serviço fica desativado (áudio não é transcrevido)', () => {
    const service = build({ ...fullConfig, apiKey: '', provider: '' });
    expect(service.isEnabled()).toBe(false);
  });

  it('provider "disabled" ignora até com API key', () => {
    const service = build({ ...fullConfig, provider: 'disabled' });
    expect(service.isEnabled()).toBe(false);
  });

  it('com API key o serviço fica ativo', () => {
    const expectEnabled = build(fullConfig);
    expect(expectEnabled.isEnabled()).toBe(true);
  });
});

describe('SpeechToTextService — validações antes de chamar o provedor', () => {
  it('áudio vazio é rejeitado sem rede', async () => {
    const service = build(fullConfig);
    const result = await service.transcribe({ buffer: Buffer.alloc(0), mimeType: 'audio/ogg' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid_audio');
  });

  it('formato que não é áudio é rejeitado', async () => {
    const service = build(fullConfig);
    const result = await service.transcribe({ buffer: Buffer.alloc(10), mimeType: 'image/png' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('unsupported_format');
  });

  it('áudio acima do limite de tamanho é rejeitado', async () => {
    const service = build(fullConfig); // maxAudioMb = 1
    const result = await service.transcribe(audio(2 * 1024 * 1024));
    expect(result.ok).toBe(false);
    expect(result.error).toBe('too_large');
  });

  it('áudio acima da duração máxima é rejeitado', async () => {
    const service = build(fullConfig); // maxDurationSeconds = 30
    const result = await service.transcribe({ ...audio(), durationSeconds: 120 });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('too_long');
  });

  it('serviço desativado devolve erro estruturado (nunca lança)', async () => {
    const service = build({ ...fullConfig, provider: 'disabled' });
    const result = await service.transcribe(audio());
    expect(result.ok).toBe(false);
    expect(result.error).toBe('disabled');
    expect(service.friendlyMessage(result.error)).toContain('digitando');
  });
});

describe('SpeechToTextService — provedor OpenAI-compatible', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('sucesso devolve o texto transcrito', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: '  dou cinquenta no bolo  ', confidence: 0.98 }),
    }) as unknown as typeof fetch;

    const service = build(fullConfig);
    const result = await service.transcribe(audio());

    expect(result.ok).toBe(true);
    expect(result.text).toBe('dou cinquenta no bolo');
    expect(result.provider).toBe('openai-compatible');
    expect(result.quality).toBe(0.98);
  });

  it('resposta 5xx vira provider_error (sem exceção)', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 }) as unknown as typeof fetch;

    const service = build(fullConfig);
    const result = await service.transcribe(audio());

    expect(result.ok).toBe(false);
    expect(result.error).toBe('provider_error');
  });

  it('provedor sem texto devolve "empty"', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: '   ' }),
    }) as unknown as typeof fetch;

    const service = build(fullConfig);
    const result = await service.transcribe(audio());

    expect(result.ok).toBe(false);
    expect(result.error).toBe('empty');
  });

  it('falha de rede vira provider_error e o serviço continua de pé', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNRESET')) as unknown as typeof fetch;

    const service = build(fullConfig);
    const result = await service.transcribe(audio());

    expect(result.ok).toBe(false);
    expect(result.error).toBe('provider_error');
  });

  it('o binário de áudio nunca aparece na mensagem de erro', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('boom')) as unknown as typeof fetch;

    const service = build(fullConfig);
    const result = await service.transcribe(audio());

    expect(JSON.stringify(result)).not.toContain('buffer');
    expect(JSON.stringify(result)).not.toContain('base64');
  });

  it('envia o prompt de domínio junto do áudio (evita número errado em pt-BR)', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: 'trezentos no porco' }),
    }) as unknown as typeof fetch;

    const service = build(fullConfig); // sem prompt no env → padrão
    await service.transcribe(audio());

    const body = (global.fetch as jest.Mock).mock.calls[0][1]?.body as FormData;
    expect(body.get('prompt')).toContain('trezentos no porco');
  });

  it('SPEECH_TO_TEXT_PROMPT=none não envia contexto ao provedor', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: 'trezentos no porco' }),
    }) as unknown as typeof fetch;

    const service = build({ ...fullConfig, prompt: 'none' });
    await service.transcribe(audio());

    const body = (global.fetch as jest.Mock).mock.calls[0][1]?.body as FormData;
    expect(body.get('prompt')).toBeNull();
  });

  it('prompt personalizado do env substitui o padrão', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: '300 no porco' }),
    }) as unknown as typeof fetch;

    const service = build({ ...fullConfig, prompt: 'contexto exclusivo do cliente' });
    await service.transcribe(audio());

    const body = (global.fetch as jest.Mock).mock.calls[0][1]?.body as FormData;
    expect(body.get('prompt')).toBe('contexto exclusivo do cliente');
  });
});

describe('SpeechToTextService — mensagens amigáveis', () => {
  it('cada erro tem uma orientação clara para o participante', () => {
    const service = build(fullConfig);
    for (const error of ['disabled', 'too_large', 'too_long', 'unsupported_format', 'timeout'] as const) {
      const message = service.friendlyMessage(error);
      expect(message.length).toBeGreaterThan(10);
      expect(message).toMatch(/lance|digite|digitando|áudio|Áudio/);
    }
  });
});
