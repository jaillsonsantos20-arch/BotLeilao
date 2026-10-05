import {
  parseNumberWords,
  spokenNumbersToDigits,
} from '../../src/modules/whatsapp/spoken-numbers';

describe('spokenNumbersToDigits — números falados em lances', () => {
  it('converte dezenas e unidades', () => {
    expect(spokenNumbersToDigits('dou cinquenta no bolo')).toBe('dou 50 no bolo');
    expect(spokenNumbersToDigits('vinte e cinco reais')).toBe('25 reais');
    expect(spokenNumbersToDigits('cento e vinte no capão')).toBe('120 no capão');
  });

  it('converte escalas ("mil e quinhentos")', () => {
    expect(spokenNumbersToDigits('mil e quinhentos')).toBe('1500');
    expect(spokenNumbersToDigits('dois mil')).toBe('2000');
  });

  it('preserva pontuação das bordas', () => {
    expect(spokenNumbersToDigits('r$ vinte e cinco')).toBe('r$ 25');
    expect(spokenNumbersToDigits('(trinta)')).toBe('(30)');
  });

  it('converte palavra hifenizada quando toda numérica', () => {
    expect(spokenNumbersToDigits('vinte-e-cinco')).toBe('25');
  });

  it('NÃO mexe em nomes de item ("Bolo de Mil Folhas")', () => {
    expect(spokenNumbersToDigits('bolo de mil folhas')).toBe('bolo de mil folhas');
  });

  it('NÃO converte "uma" sem marcador monetário (pode ser artigo)', () => {
    expect(spokenNumbersToDigits('uma garrafa térmica')).toBe('uma garrafa térmica');
  });

  it('converte "uma" com force (resposta de "qual item?")', () => {
    expect(spokenNumbersToDigits('a número um', { force: true })).toBe('a número 1');
    expect(spokenNumbersToDigits('uma', { force: true })).toBe('1');
  });

  it('com force converte unidade mesmo sem marcador', () => {
    expect(spokenNumbersToDigits('um', { force: true })).toBe('1');
  });

  it('texto sem letras volta intacto', () => {
    expect(spokenNumbersToDigits('01 300')).toBe('01 300');
    expect(spokenNumbersToDigits('')).toBe('');
  });

  it('palavras comuns permanecem intactas', () => {
    expect(spokenNumbersToDigits('bom dia a todos')).toBe('bom dia a todos');
  });

  it('não soma item e valor separados por vírgula ("dois, quatrocentos")', () => {
    expect(spokenNumbersToDigits('item número dois, quatrocentos reais')).toBe(
      'item número 2, 400 reais',
    );
  });

  it('não soma unidade seguida de centena sem conectivo ("dois quatrocentos")', () => {
    expect(spokenNumbersToDigits('dois quatrocentos reais')).toBe('2 400 reais');
  });

  it('mantém a soma quando há conectivo ("quatrocentos e dois")', () => {
    expect(spokenNumbersToDigits('quatrocentos e dois reais')).toBe('402 reais');
  });
});

describe('parseNumberWords', () => {
  it('soma unidades, dezenas e centenas com conectivo', () => {
    expect(parseNumberWords(['vinte', 'e', 'cinco'])).toBe(25);
    expect(parseNumberWords(['cento', 'e', 'dez'])).toBe(110);
    expect(parseNumberWords(['mil', 'e', 'quinhentos'])).toBe(1500);
  });

  it('devolve null para palavra que não é número', () => {
    expect(parseNumberWords(['bolo'])).toBeNull();
    expect(parseNumberWords([])).toBeNull();
  });
});
