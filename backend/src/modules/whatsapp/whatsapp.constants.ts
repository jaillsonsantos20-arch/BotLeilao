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

/** Cooldown mínimo entre recriações do cliente WhatsApp (evita loop de falhas). */
export const WHATSAPP_RECOVERY_COOLDOWN_MS = 5 * 60 * 1000;

/** Tempo máximo em CONNECTING antes do watchdog recriar o cliente (o evento "ready" às vezes não dispara). */
export const WHATSAPP_CONNECT_TIMEOUT_MS = 2 * 60 * 1000;
