import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../common/config/configuration';
import {
  SPEECH_TO_TEXT_DEFAULT_MAX_AUDIO_MB,
  SPEECH_TO_TEXT_DEFAULT_MAX_DURATION_SECONDS,
  SPEECH_TO_TEXT_DEFAULT_TIMEOUT_MS,
} from './whatsapp.constants';

/** Áudio entregue ao provedor (já validado quanto a tamanho/formato). */
export interface SpeechToTextAudio {
  /** Áudio em memória — nunca é gravado em disco nem mantido após a chamada. */
  buffer: Buffer;
  mimeType: string;
  /** Duração em segundos, quando o WhatsApp informa. */
  durationSeconds?: number | null;
}

export type SpeechToTextError =
  | 'disabled'
  | 'too_large'
  | 'too_long'
  | 'unsupported_format'
  | 'invalid_audio'
  | 'timeout'
  | 'provider_error'
  | 'empty';

export interface TranscriptionResult {
  ok: boolean;
  /** Transcrição (pt-BR) quando ok; string vazia caso contrário. */
  text: string;
  provider: string;
  model: string | null;
  language: string | null;
  durationMs: number;
  error?: SpeechToTextError;
  /** Qualidade 0..1 informada pelo provedor (quando disponível). */
  quality: number | null;
}

/** Abstração substituível: qualquer provedor implementa esta interface. */
export interface SpeechToTextProvider {
  readonly name: string;
  transcribe(audio: SpeechToTextAudio): Promise<TranscriptionResult>;
}

const AUDIO_EXTENSION: Record<string, string> = {
  'audio/ogg': 'ogg',
  'audio/ogg; codecs=opus': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/webm': 'weba',
  'audio/flac': 'flac',
  'audio/amr': 'amr',
  'audio/3gpp': '3gp',
};

function extensionFor(mimeType: string): string {
  const key = (mimeType || '').toLowerCase();
  return AUDIO_EXTENSION[key] ?? AUDIO_EXTENSION[key.split(';')[0].trim()] ?? 'ogg';
}

function baseResult(
  provider: string,
  model: string | null,
  language: string | null,
  startedAt: number,
): Pick<
  TranscriptionResult,
  'provider' | 'model' | 'language' | 'durationMs' | 'quality'
> {
  return {
    provider,
    model,
    language,
    durationMs: Date.now() - startedAt,
    quality: null,
  };
}

/**
 * Provedor OpenAI-compatible (`POST {baseUrl}/audio/transcriptions`).
 *
 * Funciona com OpenAI, Groq, OpenRouter, servidores locais (whisper.cpp,
 * faster-whisper) e qualquer API que siga o contrato de `audio/transcriptions`.
 * O transporte é o `fetch` nativo — nenhuma dependência extra.
 */
class OpenAiCompatibleSpeechProvider implements SpeechToTextProvider {
  readonly name = 'openai-compatible';

  constructor(
    private readonly settings: {
      baseUrl: string;
      apiKey: string;
      model: string;
      language: string;
      timeoutMs: number;
    },
  ) {}

  async transcribe(audio: SpeechToTextAudio): Promise<TranscriptionResult> {
    const startedAt = Date.now();
    const base = baseResult(this.name, this.settings.model, this.settings.language, startedAt);

    const form = new FormData();
    // Cópia em memória: o Blob tipa como ArrayBuffer (o Buffer do Node é
    // ArrayBufferLike) e o original é descartado logo após a chamada.
    const bytes = new Uint8Array(audio.buffer.length);
    bytes.set(audio.buffer);
    const blob = new Blob([bytes], {
      type: audio.mimeType || 'audio/ogg',
    });
    form.append('file', blob, `audio.${extensionFor(audio.mimeType)}`);
    form.append('model', this.settings.model);
    form.append('language', this.settings.language);
    form.append('response_format', 'json');

    let response: Response;
    try {
      response = await fetch(`${this.settings.baseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.settings.apiKey}` },
        body: form,
        signal: AbortSignal.timeout(this.settings.timeoutMs),
      });
    } catch (error) {
      const message = (error as Error)?.message ?? String(error);
      const isTimeout = /timeout|abort/i.test(message);
      return {
        ...base,
        ok: false,
        text: '',
        error: isTimeout ? 'timeout' : 'provider_error',
        durationMs: Date.now() - startedAt,
      };
    }

    if (!response.ok) {
      return { ...base, ok: false, text: '', error: 'provider_error' };
    }

    let payload: { text?: unknown; confidence?: unknown };
    try {
      payload = (await response.json()) as { text?: unknown; confidence?: unknown };
    } catch {
      return { ...base, ok: false, text: '', error: 'provider_error' };
    }

    const text = typeof payload?.text === 'string' ? payload.text.trim() : '';
    if (!text) {
      return { ...base, ok: false, text: '', error: 'empty' };
    }

    const quality =
      typeof payload?.confidence === 'number' &&
      Number.isFinite(payload.confidence) &&
      payload.confidence >= 0 &&
      payload.confidence <= 1
        ? payload.confidence
        : null;

    return { ...base, ok: true, text, quality, durationMs: Date.now() - startedAt };
  }
}

/** Provedor desativado: devolve erro estruturado sem lançar exceção. */
class DisabledSpeechProvider implements SpeechToTextProvider {
  readonly name = 'disabled';

  async transcribe(): Promise<TranscriptionResult> {
    return {
      ok: false,
      text: '',
      provider: this.name,
      model: null,
      language: null,
      durationMs: 0,
      error: 'disabled',
      quality: null,
    };
  }
}

/**
 * Serviço único de Speech-to-Text.
 *
 * O áudio NUNCA é registrado lance diretamente: o resultado é texto e segue
 * para o mesmo pipeline de interpretação das mensagens digitadas. O buffer de
 * áudio vive apenas em memória durante a chamada (privacidade: nada é gravado
 * em disco, nada é logado, nenhuma URL pública é criada).
 */
@Injectable()
export class SpeechToTextService {
  private readonly logger = new Logger(SpeechToTextService.name);
  private readonly provider: SpeechToTextProvider;
  private readonly maxAudioMb: number;
  private readonly maxDurationSeconds: number;

  constructor(configService: ConfigService<AppConfig>) {
    const stt = configService.get('speechToText', { infer: true })!;
    this.maxAudioMb =
      Number.isFinite(stt.maxAudioMb) && stt.maxAudioMb > 0
        ? stt.maxAudioMb
        : SPEECH_TO_TEXT_DEFAULT_MAX_AUDIO_MB;
    this.maxDurationSeconds =
      Number.isFinite(stt.maxDurationSeconds) && stt.maxDurationSeconds > 0
        ? stt.maxDurationSeconds
        : SPEECH_TO_TEXT_DEFAULT_MAX_DURATION_SECONDS;
    const providerName = (stt.provider ?? '').trim().toLowerCase();
    const enabled =
      providerName === 'disabled'
        ? false
        : providerName === '' || providerName === 'openai' || providerName === 'openai-compatible'
          ? Boolean(stt.apiKey)
          : false;

    if (!enabled) {
      if (providerName && providerName !== 'disabled' && !stt.apiKey) {
        this.logger.warn(
          `Speech-to-Text configurado como "${providerName}" sem API key — áudio desativado.`,
        );
      }
      this.provider = new DisabledSpeechProvider();
      return;
    }

    this.provider = new OpenAiCompatibleSpeechProvider({
      baseUrl: stt.baseUrl,
      apiKey: stt.apiKey,
      model: stt.model,
      language: stt.language,
      timeoutMs: stt.timeoutMs || SPEECH_TO_TEXT_DEFAULT_TIMEOUT_MS,
    });
    this.logger.log(`Speech-to-Text ativo (provedor OpenAI-compatible, modelo ${stt.model}).`);
  }

  /** true quando há um provedor configurado (áudio será transcrito). */
  isEnabled(): boolean {
    return this.provider.name !== 'disabled';
  }

  /**
   * Transcreve áudio em texto (pt-BR por padrão).
   *
   * Nunca lança: falhas viram `TranscriptionResult` com `error` preenchido,
   * para que o chamador responda ao participante sem derrubar o fluxo.
   */
  async transcribe(audio: SpeechToTextAudio): Promise<TranscriptionResult> {
    const maxMb = this.maxAudioMb;
    const maxDuration = this.maxDurationSeconds;

    if (!audio?.buffer || audio.buffer.length === 0) {
      return this.failed('invalid_audio', 'disabled');
    }
    if (!audio.mimeType?.toLowerCase().startsWith('audio/')) {
      return this.failed('unsupported_format', this.provider.name);
    }
    if (audio.buffer.length > maxMb * 1024 * 1024) {
      return this.failed('too_large', this.provider.name);
    }
    if (
      typeof audio.durationSeconds === 'number' &&
      Number.isFinite(audio.durationSeconds) &&
      audio.durationSeconds > maxDuration
    ) {
      return this.failed('too_long', this.provider.name);
    }

    try {
      return await this.provider.transcribe(audio);
    } catch (error) {
      // Defesa: o provedor não deve lançar, mas uma exceção aqui não pode
      // derrubar o roteamento de mensagens.
      this.logger.warn(`Falha inesperada no Speech-to-Text: ${(error as Error).message}`);
      return this.failed('provider_error', this.provider.name);
    }
  }

  /** Mensagem amigável quando o áudio não pôde ser transcrito. */
  friendlyMessage(error?: SpeechToTextError): string {
    switch (error) {
      case 'disabled':
        return '🤖 Não consigo processar áudio no momento.\nEnvie o seu lance digitando o valor (ex.: *01 50*).';
      case 'too_large':
      case 'too_long':
        return '⏱️ Áudio muito longo para transcrever.\nEnvie um áudio mais curto ou digite o lance.';
      case 'unsupported_format':
      case 'invalid_audio':
        return '🎤 Não consegui ler este áudio.\nEnvie novamente ou digite o seu lance.';
      case 'timeout':
        return '⏳ A transcrição demorou demais.\nTente novamente ou digite o seu lance.';
      default:
        return '🎤 Não entendi o áudio.\nEnvie novamente ou digite o seu lance.';
    }
  }

  private failed(error: SpeechToTextError, provider: string): TranscriptionResult {
    return {
      ok: false,
      text: '',
      provider,
      model: null,
      language: null,
      durationMs: 0,
      error,
      quality: null,
    };
  }
}
