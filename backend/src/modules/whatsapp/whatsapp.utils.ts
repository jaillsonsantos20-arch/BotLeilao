import { Decimal } from '@prisma/client/runtime/library';
import { join, sep } from 'path';

const UPLOADS_URL_PREFIX = '/api/uploads/';

/**
 * Converte a URL pública de uma imagem carregada no painel (`/api/uploads/...`)
 * no caminho local do arquivo, pronto para envio no WhatsApp.
 *
 * Retorna `undefined` para URLs externas (imagens que não passaram pelo painel)
 * ou quando o caminho não mapeia para o diretório de uploads local.
 */
export function imageUrlToLocalPath(
  imageUrl: string | null | undefined,
): string | undefined {
  if (!imageUrl || !imageUrl.startsWith(UPLOADS_URL_PREFIX)) return undefined;
  const relative = imageUrl
    .slice(UPLOADS_URL_PREFIX.length)
    .split('/')
    .join(sep);
  return join(process.cwd(), 'uploads', relative);
}

/**
 * Formata um valor monetário no padrão brasileiro: R$ 1.234,56.
 */
export function formatCurrency(value: Decimal | number | string): string {
  const number =
    value instanceof Decimal ? value.toNumber() : typeof value === 'number' ? value : parseFloat(value);
  if (Number.isNaN(number)) return 'R$ 0,00';
  return number
    .toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
    .replace(/\u00A0/g, ' ');
}

/**
 * Interpreta o valor digitado no WhatsApp como número.
 * Aceita: "150", "150,00", "R$ 150", "1.500,00".
 */
export function parseAmount(raw: string): number | null {
  let cleaned = raw
    .trim()
    .replace(/\s+/g, '')
    .replace('R$', '')
    .replace(/\u00A0/g, '')
    .trim();

  if (!cleaned) return null;

  const hasThousands = cleaned.includes('.');
  const hasDecimalComma = cleaned.includes(',');

  if (hasDecimalComma) {
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (hasThousands) {
    const lastDot = cleaned.lastIndexOf('.');
    const afterDot = cleaned.slice(lastDot + 1);
    if (afterDot.length === 3 && !cleaned.includes(',')) {
      cleaned = cleaned.replace(/\./g, '');
    }
  }

  const number = Number(cleaned);
  if (Number.isNaN(number) || !Number.isFinite(number)) return null;

  return Math.round(number * 100) / 100;
}

/**
 * Extrai um nome de contato para o participante (com fallback ao número).
 */
export function participantLabel(name: string | null | undefined, phone: string): string {
  return name?.trim() || `Participante ${phone}`;
}
