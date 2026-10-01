import {
  applyTranscriptionQuality,
  ConfidenceAssessment,
  ConfidenceInput,
  evaluateBidConfidence,
} from '../../src/modules/whatsapp/confidence.engine';
import {
  createParser,
  isValueOnlyAfterFillers,
  ListBidParser,
} from '../../src/modules/whatsapp/list-bid.parser';

const items = [
  { id: 'a1', name: 'Bolo de goma', order: 1 },
  { id: 'a2', name: 'Capão 01', order: 2 },
  { id: 'a3', name: 'Capão 02', order: 3 },
  { id: 'a4', name: 'Garrafa térmica 2.5lt', order: 4 },
  { id: 'a5', name: 'Garrafa plástica 1lt', order: 5 },
];

function parser(): ListBidParser {
  return createParser(items.map((i) => ({ ...i })));
}

function evaluate(text: string, overrides: Partial<ConfidenceInput> = {}): ConfidenceAssessment {
  const parsed = parser().parseMessage(text);
  const looksLikeBid =
    /^\s*(?:r\$|\$|[\d.,])/i.test(text) || isValueOnlyAfterFillers(text);
  return evaluateBidConfidence({
    parsed,
    source: 'TEXT',
    replyContextUsed: false,
    looksLikeBid,
    ...overrides,
  });
}

describe('Confidence Engine — nível 1: alta confiança registra', () => {
  it('Nº explícito do item registra direto', () => {
    const a = evaluate('01 300');
    expect(a.decision).toBe('register');
    expect(a.matchedBy).toBe('item_number');
    expect(a.confidence).toBeGreaterThanOrEqual(0.95);
  });

  it('nome único do item registra direto', () => {
    const a = evaluate('bolo 25');
    expect(a.decision).toBe('register');
    expect(a.matchedBy).toBe('item_name_partial');
    expect(a.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it('nome idêntico ao da lista registra direto', () => {
    const a = evaluate('25 no capão 01');
    expect(a.decision).toBe('register');
    expect(a.matchedBy).toBe('item_name_exact');
  });

  it('item citado na mensagem citada (Responder) registra direto', () => {
    const a = evaluate('300', { replyContextUsed: true });
    expect(a.decision).toBe('register');
    expect(a.matchedBy).toBe('reply_context');
    expect(a.confidence).toBeGreaterThanOrEqual(0.95);
  });

  it('nome parcial com cobertura baixa NÃO registra: confirma', () => {
    // "térmica" cobre só 1 dos 3 tokens de "Garrafa térmica 2.5lt"
    const a = evaluate('50 térmica');
    expect(a.decision).toBe('confirm');
    expect(a.matchedBy).toBe('item_name_partial');
    expect(a.confidence).toBeLessThan(0.85);
  });
});

describe('Confidence Engine — nível 2: confiança intermediária confirma', () => {
  it('erro de digitação no nome pede confirmação', () => {
    const a = evaluate('bolo degoma 50');
    expect(a.decision).toBe('confirm');
    expect(a.matchedBy).toBe('item_name_fuzzy');
  });

  it('a decisão de confirmação não registra nada (só descreve)', () => {
    const a = evaluate('bolo degoma 50');
    expect(a.decision).not.toBe('register');
    expect(a.reason).toContain('confirma');
  });
});

describe('Confidence Engine — nível 3: ambiguidade esclarece', () => {
  it('dois itens parecidos → clarify, nunca escolhe', () => {
    const a = evaluate('25 no capão');
    expect(a.decision).toBe('clarify');
    expect(a.confidence).toBeLessThan(0.7);
  });

  it('valor puro sem item → clarify', () => {
    expect(evaluate('300').decision).toBe('clarify');
    expect(evaluate('$22').decision).toBe('clarify');
    expect(evaluate('sou 120').decision).toBe('clarify');
  });

  it('Nº inexistente orienta o participante', () => {
    const a = evaluate('99 300');
    expect(a.decision).toBe('orient_number');
    expect(a.reason).toContain('99');
  });

  it('número que não forma valor orienta o formato', () => {
    expect(evaluate('0').decision).toBe('orient_format');
  });
});

describe('Confidence Engine — conversa comum', () => {
  it.each(['bom dia a todos', 'kkk', 'obrigado'])(
    '"%s" é ignorada em silêncio',
    (text) => {
      expect(evaluate(text).decision).toBe('ignore');
      expect(evaluate(text).confidence).toBe(0);
    },
  );
});

describe('Confidence Engine — qualidade da transcrição', () => {
  it('qualidade ruim rebaixa "register" para "confirm"', () => {
    const good = evaluate('01 300');
    expect(good.decision).toBe('register');

    const bad = applyTranscriptionQuality(good, 0.3);
    expect(bad.decision).toBe('confirm');
    expect(bad.reason).toContain('baixa qualidade');
  });

  it('qualidade boa (ou ausente) não muda nada', () => {
    const good = evaluate('01 300');
    expect(applyTranscriptionQuality(good, 0.95).decision).toBe('register');
    expect(applyTranscriptionQuality(good, null).decision).toBe('register');
    expect(applyTranscriptionQuality(good, undefined).decision).toBe('register');
  });

  it('ambiguidade continua ambiguidade mesmo com transcrição ruim', () => {
    const ambiguous = evaluate('25 no capão');
    expect(applyTranscriptionQuality(ambiguous, 0.2).decision).toBe('clarify');
  });

  it('áudio usa os MESMOS limites do texto', () => {
    const audio = evaluate('bolo 25', { source: 'AUDIO' });
    expect(audio.decision).toBe('register');
    expect(audio.source).toBe('AUDIO');
  });
});
