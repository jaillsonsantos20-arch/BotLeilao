/**
 * Constantes do bot WhatsApp.
 */
export const WHATSAPP_DEFAULT_DURATION_MINUTES = 2;
export const WHATSAPP_MIN_DURATION_MINUTES = 1;
export const WHATSAPP_MAX_DURATION_MINUTES = 1440;
export const WHATSAPP_WARNING_THIRD_SECONDS = 180; // alerta "perto de finalizar" (3 min)
export const WHATSAPP_WARNING_FIRST_SECONDS = 60;
export const WHATSAPP_WARNING_SECOND_SECONDS = 30;
export const WHATSAPP_TICK_INTERVAL_MS = 1000;
export const WHATSAPP_DB_SWEEP_INTERVAL_MS = 30000;
export const WHATSAPP_LIST_STATUS_INTERVAL_MS = 15000; // checagem do status periódico das listas
export const WHATSAPP_MAX_BID_MESSAGE_LENGTH = 32;

/** Pausa entre o envio dos cards de item (evita disparo em rajada ao abrir a lista). */
export const WHATSAPP_ITEM_CARD_DELAY_MS = 350;

/** Cooldown mínimo entre recriações do cliente WhatsApp (evita loop de falhas). */
export const WHATSAPP_RECOVERY_COOLDOWN_MS = 5 * 60 * 1000;

/** Tempo máximo em CONNECTING antes do watchdog recriar o cliente (o evento "ready" às vezes não dispara). */
export const WHATSAPP_CONNECT_TIMEOUT_MS = 2 * 60 * 1000;

/** Máximo de vínculos "mensagem -> item" mantidos em memória (suporte ao "Responder"). */
export const WHATSAPP_REPLY_CONTEXT_MAX = 2000;

/** Idade mínima para apagar vínculos "mensagem -> item" do banco (em dias). */
export const WHATSAPP_REPLY_BINDING_TTL_DAYS = 30;

// ---------------------------------------------------------------------------
// Confirmação de lance (confiança intermediária)
// ---------------------------------------------------------------------------

/** Validade de uma confirmação pendente antes de expirar. */
export const BID_CONFIRMATION_TTL_MS = 2 * 60 * 1000;

/** Máximo de confirmações pendentes mantidas em memória. */
export const BID_CONFIRMATION_MAX = 1000;

/** Mensagens idempotentes (mesmo WhatsApp Message ID nunca processa duas vezes). */
export const WHATSAPP_PROCESSED_MESSAGE_TTL_MS = 10 * 60 * 1000;
export const WHATSAPP_PROCESSED_MESSAGE_MAX = 5000;

// ---------------------------------------------------------------------------
// Contexto de disputa ativa (contexto automático por item)
// ---------------------------------------------------------------------------

/**
 * Validade do contexto de disputa de um item (em segundos).
 *
 * 5 minutos: maior que o TTL do "qual item?" (2 min) e que a duração padrão de
 * um lance (2 min), para nunca derrubar uma cadeia natural de lances no meio;
 * curto o bastante para que um item parado há 5 min não "herde" um lance novo.
 */
export const ACTIVE_BID_CONTEXT_TTL_SECONDS = 5 * 60;
export const ACTIVE_BID_CONTEXT_TTL_MS = ACTIVE_BID_CONTEXT_TTL_SECONDS * 1000;

/** Máximo de contextos de disputa mantidos em memória (por processo). */
export const ACTIVE_BID_CONTEXT_MAX = 2000;

// ---------------------------------------------------------------------------
// Speech-to-Text (áudio)
// ---------------------------------------------------------------------------

/** Teto padrão de duração de áudio aceito (sobrescrevível por env). */
export const SPEECH_TO_TEXT_DEFAULT_MAX_AUDIO_MB = 8;
export const SPEECH_TO_TEXT_DEFAULT_MAX_DURATION_SECONDS = 180;
export const SPEECH_TO_TEXT_DEFAULT_TIMEOUT_MS = 20000;

/**
 * Contexto enviado ao provedor Whisper (`prompt`, limite de 224 tokens).
 *
 * Sem contexto o modelo erra números por extenso em pt-BR ("trezentos no
 * porco" virava "Presentes no porco") e o lance é descartado por não ter
 * valor. O prompt fixa o domínio (leilão) e a forma dos lances.
 *
 * Sobrescrevível por `SPEECH_TO_TEXT_PROMPT`; use "none" para não enviar.
 */
export const SPEECH_TO_TEXT_DEFAULT_PROMPT =
  'Áudio de leilão em português do Brasil, num grupo de WhatsApp. ' +
  'Os participantes dão lances dizendo o valor por extenso seguido do nome do item, ' +
  'por exemplo: "trezentos no porco", "cento e cinquenta no bolo", ' +
  '"duzentos e cinquenta na bijuteria". ' +
  'Transcreva exatamente o que foi falado, mantendo os números por extenso.';

/** Valor de `SPEECH_TO_TEXT_PROMPT` que desliga o envio de contexto. */
export const SPEECH_TO_TEXT_PROMPT_OFF = 'none';
