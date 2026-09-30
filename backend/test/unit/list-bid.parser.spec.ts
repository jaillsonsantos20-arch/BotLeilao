import { createParser, isValueOnlyAfterFillers, ListBidParser } from '../../src/modules/whatsapp/list-bid.parser';

const baseItems = [
  { id: 'a1', name: 'Bolo de goma', order: 1 },
  { id: 'a2', name: 'Capão 01', order: 2 },
  { id: 'a3', name: 'Capão 02', order: 3 },
  { id: 'a4', name: 'Garrafa térmica 2.5lt', order: 4 },
  { id: 'a5', name: 'Garrafa plástica 1lt', order: 5 },
];

/** Parser novo a cada teste (o setItems faz splice no array). */
function parser(): ListBidParser {
  return createParser(baseItems.map((i) => ({ ...i })));
}

describe('ListBidParser — Nº do item + valor', () => {
  it('interpreta "01 300"', () => {
    const r = parser().parseMessage('01 300');
    expect(r.amount).toBe(300);
    expect(r.itemNumber).toBe(1);
    expect(r.itemId).toBe('a1');
    expect(r.ambiguous).toBe(false);
    expect(r.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it('interpreta separador de hífen "01-300"', () => {
    const r = parser().parseMessage('01-300');
    expect(r.amount).toBe(300);
    expect(r.itemId).toBe('a1');
  });

  it('ignora o símbolo "r$" entre Nº e valor ("01 r$ 300")', () => {
    const r = parser().parseMessage('01 r$ 300');
    expect(r.amount).toBe(300);
    expect(r.itemId).toBe('a1');
  });

  it('interpreta valor com milhar e decimal ("01 1.500,00")', () => {
    const r = parser().parseMessage('01 1.500,00');
    expect(r.amount).toBe(1500);
    expect(r.itemId).toBe('a1');
  });

  it('orienta quando o Nº não existe na lista ("99 300")', () => {
    const r = parser().parseMessage('99 300');
    expect(r.amount).toBe(300);
    expect(r.itemNumber).toBe(99);
    expect(r.itemId).toBeNull();
    expect(r.ambiguous).toBe(false);
  });

  it('interpreta "3. 110" (ponto final no numero do item)', () => {
    const r = parser().parseMessage('3. 110');
    expect(r.amount).toBe(110);
    expect(r.itemNumber).toBe(3);
    expect(r.itemId).toBe('a3');
    expect(r.ambiguous).toBe(false);
  });

  it('interpreta "3, 110" (virgula final no numero do item)', () => {
    const r = parser().parseMessage('3, 110');
    expect(r.amount).toBe(110);
    expect(r.itemNumber).toBe(3);
    expect(r.itemId).toBe('a3');
  });

  it('nao confunde milhar com ponto ("1.100 50")', () => {
    const r = parser().parseMessage('1.100 50');
    expect(r.amount).toBe(1100);
    // nao vira item 1: o sobra-resto "50" nao casa nenhum item da lista
    expect(r.itemNumber).toBeNull();
    expect(r.itemId).toBeNull();
  });

  it('interpreta "3. $22,00" (Nº com ponto + valor com cifrao)', () => {
    const r = parser().parseMessage('3. $22,00');
    expect(r.amount).toBe(22);
    expect(r.itemNumber).toBe(3);
    expect(r.itemId).toBe('a3');
    expect(r.ambiguous).toBe(false);
  });

  it('interpreta "02-35,00 R$" (hifen e R$ solto no fim)', () => {
    const r = parser().parseMessage('02-35,00 R$');
    expect(r.amount).toBe(35);
    expect(r.itemNumber).toBe(2);
    expect(r.itemId).toBe('a2');
  });
});

describe('ListBidParser — nome do item + valor', () => {
  it('interpreta nome único antes do valor ("bolo 25")', () => {
    const r = parser().parseMessage('bolo 25');
    expect(r.amount).toBe(25);
    expect(r.itemId).toBe('a1');
    expect(r.ambiguous).toBe(false);
  });

  it('remove preenchimentos ("25 no capão")', () => {
    const r = parser().parseMessage('25 no capão');
    expect(r.amount).toBe(25);
    // Dois "Capão" → nunca escolhe sozinho
    expect(r.ambiguous).toBe(true);
    expect(r.itemId).toBeNull();
    expect(r.candidates.map((c) => c.itemNumber).sort()).toEqual([2, 3]);
  });

  it('usa o nome completo quando único ("25 no capão 01")', () => {
    const r = parser().parseMessage('25 no capão 01');
    expect(r.amount).toBe(25);
    expect(r.itemId).toBe('a2');
    expect(r.ambiguous).toBe(false);
  });

  it('resolve só por número quando não há nome ("300 no 02")', () => {
    const r = parser().parseMessage('300 no 02');
    expect(r.amount).toBe(300);
    expect(r.itemNumber).toBe(2);
    expect(r.itemId).toBe('a2');
    expect(r.ambiguous).toBe(false);
  });

  it('item com número no nome não confunde com o valor ("50 na garrafa térmica 2.5lt")', () => {
    const r = parser().parseMessage('50 na garrafa térmica 2.5lt');
    expect(r.amount).toBe(50);
    expect(r.itemId).toBe('a4');
    expect(r.ambiguous).toBe(false);
    expect(r.confidence).toBeGreaterThanOrEqual(0.85);
  });
});

describe('ListBidParser — ambiguidade (regra de ouro: nunca adivinhar)', () => {
  it('"25 na garrafa" com 2 garrafas fica ambíguo', () => {
    const r = parser().parseMessage('25 na garrafa');
    expect(r.amount).toBe(25);
    expect(r.ambiguous).toBe(true);
    expect(r.itemId).toBeNull();
    expect(r.candidates).toHaveLength(2);
    expect(r.candidates.every((c) => c.itemName.includes('Garrafa'))).toBe(true);
    expect(r.needsUserInput).toBe(true);
  });

  it('valor puro sem item não gera lance', () => {
    const r = parser().parseMessage('300');
    expect(r.amount).toBe(300);
    expect(r.itemId).toBeNull();
    expect(r.itemNumber).toBeNull();
  });

  it('aceita cifrao no valor ("$22,00" e "40$")', () => {
    const a = parser().parseMessage('$22,00');
    expect(a.amount).toBe(22);
    expect(a.itemId).toBeNull();
    expect(a.itemNumber).toBeNull();

    const b = parser().parseMessage('40$');
    expect(b.amount).toBe(40);
    expect(b.itemId).toBeNull();
    expect(b.itemNumber).toBeNull();
  });

  it('nome não relacionado a lance não gera candidatos', () => {
    const r = parser().parseMessage('bom dia a todos');
    expect(r.amount).toBeNull();
    expect(r.itemId).toBeNull();
    expect(r.ambiguous).toBe(false);
  });

  it('não trata texto conversacional como lance ("vou levar 3 caixas")', () => {
    const r = parser().parseMessage('vou levar 3 caixas');
    expect(r.itemId).toBeNull();
    expect(r.ambiguous).toBe(true);
    expect(r.candidates).toHaveLength(0);
  });
});

describe('ListBidParser — frases naturais (verbo + valor + item)', () => {
  const frases = [
    'Lance de 120 no Bolo',
    'Sou 120 no bolo',
    'quero 120 bolo',
    'quer dar 120 no bolo',
    'vou levar 120 no bolo',
    '120 no bolo',
  ];

  it.each(frases)('%s → item 1, R$ 120', (frase) => {
    const r = parser().parseMessage(frase);
    expect(r.amount).toBe(120);
    expect(r.itemId).toBe('a1');
    expect(r.itemNumber).toBe(1);
    expect(r.ambiguous).toBe(false);
    expect(r.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it('detecta valor puro quando sobra so o numero ("sou 120", "lance de 120")', () => {
    expect(isValueOnlyAfterFillers('sou 120')).toBe(true);
    expect(isValueOnlyAfterFillers('lance de 120')).toBe(true);
    expect(isValueOnlyAfterFillers('R$ 22')).toBe(true);
  });

  it('nao marca conversa como valor puro ("vou levar 3 caixas")', () => {
    expect(isValueOnlyAfterFillers('vou levar 3 caixas')).toBe(false);
    expect(isValueOnlyAfterFillers('bom dia a todos')).toBe(false);
  });
});
