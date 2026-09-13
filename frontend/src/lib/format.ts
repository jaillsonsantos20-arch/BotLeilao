/**
 * Formatação monetária no padrão brasileiro.
 */
export function formatCurrency(value: string | number): string {
  const number = typeof value === 'string' ? parseFloat(value) : value;
  if (Number.isNaN(number)) return 'R$ 0,00';
  return number.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/**
 * Formata uma data ISO para o padrão brasileiro.
 */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Converte uma data para o formato aceito pelos filtros (YYYY-MM-DD).
 * Aceita string ISO ou Date; valores nulos/indefinidos retornam vazio.
 */
export function toDateInputValue(date: Date | string | null | undefined): string {
  if (!date) return '';
  const parsed = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}
