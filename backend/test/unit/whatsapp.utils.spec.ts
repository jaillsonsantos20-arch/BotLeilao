import { formatCurrency, parseAmount, participantLabel } from '../../src/modules/whatsapp/whatsapp.utils';

describe('parseAmount (interpretação de valores do WhatsApp)', () => {
  it('interpreta números inteiros', () => {
    expect(parseAmount('100')).toBe(100);
    expect(parseAmount('150')).toBe(150);
  });

  it('interpreta valores com vírgula decimal', () => {
    expect(parseAmount('150,00')).toBe(150);
    expect(parseAmount('150,50')).toBe(150.5);
  });

  it('interpreta valores com R$', () => {
    expect(parseAmount('R$ 150')).toBe(150);
    expect(parseAmount('R$150,00')).toBe(150);
  });

  it('interpreta milhares', () => {
    expect(parseAmount('1.500')).toBe(1500);
    expect(parseAmount('1.500,00')).toBe(1500);
    expect(parseAmount('12.345,67')).toBe(12345.67);
  });

  it('rejeita valores inválidos', () => {
    expect(parseAmount('abc')).toBeNull();
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('!!')).toBeNull();
  });
});

describe('formatCurrency', () => {
  it('formata no padrão brasileiro', () => {
    expect(formatCurrency(1500)).toBe('R$ 1.500,00');
    expect(formatCurrency(99.9)).toBe('R$ 99,90');
  });
});

describe('participantLabel', () => {
  it('usa o nome quando disponível', () => {
    expect(participantLabel('Maria', '5511999999999')).toBe('Maria');
  });

  it('usa o telefone como fallback', () => {
    expect(participantLabel(null, '5511999999999')).toBe('Participante 5511999999999');
    expect(participantLabel(undefined, '5511999999999')).toBe('Participante 5511999999999');
  });
});
