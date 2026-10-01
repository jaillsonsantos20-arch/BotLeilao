/**
 * Parser determinístico de mensagens de lance para o modo "lista" do LanceZap.
 * 
 * O interpretador NÃO cria Bid diretamente. Ele apenas interpreta a intenção da mensagem
 * e retorna um ParsedBidResult que a camada de negócio (AuctionsService.placeBid) validará
 * e registrará.
 * 
 * Características:
 * - 100% determinístico (sem IA generativa)
 * - Reutiliza parseAmount existente para valores monetários
 * - Matching em camadas: número → nome → fuzzy → contexto
 * - Produz candidatos e níveis de confiança
 * - NUNCA escolhe arbitrariamente entre itens semelhantes (regra de ouro)
 * - Retorna estado ambíguo quando houver dúvida (preferir perguntar a registrar errado)
 * - Integração com PendingBidContext para resolução posterior
 */
import { parseAmount } from './whatsapp.utils';

/**
 * Interface recebida do leilão ativo (items do snapshot).
 * Em produção, viria do listAuctionSnapshot do AuctionEngine.
 */
interface Item {
  id: string;
  name: string; // nome original, ex: "Capão 01", "Garrafa térmica de 2.5lt"
  order: number; // posição 1-based no leilão
  /**
   * Variações/sinônimos cadastrados pelo administrador, JÁ normalizados e
   * apenas as ativas (ex.: ["boi", "gado", "novilho"] para "Garrote").
   *
   * Uma variação nunca é um item novo: é outra forma de nomear o mesmo item.
   * O snapshot de leilão carrega apenas `active = true` (item.inativo não
   * participa da interpretação).
   */
  aliases?: string[];
}

/**
 * Como o item foi identificado na mensagem.
 *
 * É o fator mais forte do Confidence Engine: ele diz ao motor se o item veio
 * de um número explícito (certeza), de um nome completo (quase certeza), de um
 * nome parcial (confirmação depende da cobertura) ou de fuzzy (sempre
 * confirma). `reply_context` e `active_bid_context` são preenchidos pelo
 * motor, nunca pelo parser.
 *
 * `item_alias` = termo cadastrado pelo administrador na lista de variações do
 * item ("150 no boi" → "Garrote"): evidência forte, mas nunca vence um
 * conflito entre dois itens — nesse caso o parser devolve `ambiguous`.
 */
export type BidMatchedBy =
  | 'item_number'
  | 'item_name_exact'
  | 'item_name_partial'
  | 'item_name_fuzzy'
  | 'item_alias'
  | 'reply_context'
  | 'active_bid_context'
  | 'none';

/**
 * Resultado da interpretação de uma mensagem de lance.
 * O interpretador APENAS interpreta - NÃO cria lance nem valida regras de negócio.
 *
 * Todos os campos são preenchidos para que a camada de negócio possa tomar a decisão
 * adequada (registrar, perguntar, rejeitar).
 */
export interface ParsedBidResult {
  originalMessage: string;
  normalizedMessage: string;

  // Valor monetário
  amount: number | null; // valor em reais (ex: 25.5 para R$ 25,50)
  amountRaw: string | null; // texto original do valor

  // Identificação do item
  itemNumber: number | null; // nº do item 1-based (como aparece no WhatsApp)
  itemId: string | null; // ID do item no banco, se encontrado
  itemName: string | null; // nome original do item correspondente

  /** Como o item foi identificado (fator principal de confiança). */
  matchedBy: BidMatchedBy;
  /**
   * Trecho da mensagem que casou com o item — para `item_alias` é a variação
   * cadastrada usada no reconhecimento (ex.: "boi"). Nulo nas outras origens.
   */
  matchedText?: string | null;
  /**
   * Fração do nome do item (sem palavras de preenchimento) presente na
   * mensagem: 1.0 = nome inteiro citado, 0.5 = metade. Usado para decidir se
   * um nome parcial registra direto ou pede confirmação. 1.0 quando não há
   * nome na mensagem (match por número).
   */
  matchCoverage: number;

  // Confiança e ambiguidade
  confidence: number; // 0.0 a 1.0 - confiança geral na interpretação
  ambiguous: boolean; // true se houver múltipla correspondência indistinguível

  // Candidatos ranqueados (máximo 3)
  candidates: Array<{
    itemNumber: number;
    itemName: string;
    normalizedName: string;
    score: number; // 0.0 a 1.0 - pontuação de correspondência
  }>;

  // Motivo legível da decisão
  reason: string;

  // Se o chamador deve pedir mais info ao usuário
  needsUserInput: boolean;

  // Contexto pendente associado (se houver)
  pendingContextId?: string;
}

/**
 * Normaliza um texto para comparação: minúsculas, sem acentos e com espaços
 * colapsados.
 *
 * É o ÚNICO utilitário de normalização do projeto: mensagens de lance, nomes
 * de item e variações cadastradas pelo administrador passam por aqui
 * (" BOI " → "boi", "Novilho." → "novilho", "Garçáfa Térmica" → "garcafa termica").
 */
export function normalizeMessage(message: string): string {
  let result = message.toLowerCase();
  // Remove acentos via normalização NFD
  result = result.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  // Colapsa múltiplos espaços e trim
  result = result.replace(/\s+/g, ' ').trim();
  return result;
}

/**
 * Remove palavras comuns que não são essenciais para identificação:
 * moeda, verbo/intenção de lance e preposições/artigos.
 * Assim "sou 120 no bolo" / "quer dar 120 no bolo" viram só "bolo"
 * e casam com o nome do item (nível de tokens = 1.0).
 */
const fillerWords = new Set([
  // moeda / intenção
  'r$', '$', 'real', 'reais', 'lance', 'lances', 'valor', 'oferta',
  // verbo de lance
  'dou', 'sou', 'quero', 'quer', 'queria', 'dar', 'levar', 'levo', 'pego',
  'pago', 'fico', 'fica', 'vou', 'vamos', 'faz', 'fazer', 'manda', 'dessa', 'desse',
  // preposição / artigo
  'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'nos', 'nas',
  'pro', 'pra', 'para', 'por', 'com', 'o', 'a', 'os', 'as', 'um', 'uma',
]);

function stripFillerWords(message: string): string {
  return message
    .split(/\s+/)
    .filter(token => !fillerWords.has(token.toLowerCase()))
    .join(' ');
}

/**
 * true quando, removidas as palavras de preenchimento, sobra só o valor:
 * "sou 120", "lance de 120", "$22". Usado pelo motor para responder
 * "qual item?" em vez de ignorar a mensagem em silêncio.
 */
export function isValueOnlyAfterFillers(message: string): boolean {
  const stripped = stripFillerWords(normalizeMessage(message));
  return /\d/.test(stripped) && /^[\s\d.,rR$]*$/.test(stripped);
}

// ---------------------------------------------------------------------------
// Variações/sinônimos cadastrados pelo administrador (item alias)
// ---------------------------------------------------------------------------

/**
 * Score mínimo de um concorrente pelo NOME do item para disputar uma
 * variação. 0.85 = cobertura total dos tokens da mensagem ("boi" dentro de
 * "Boi para reprodução"). Abaixo disso a variação vence; acima disso o parser
 * pergunta qual item — variação NUNCA escolhe sozinha entre dois itens.
 */
export const ALIAS_COMPETE_MIN = 0.85;

/** Score de variação casada de forma exata (mensagem = variação). */
const ALIAS_SCORE_EXACT = 0.97;
/** Score de variação encontrada dentro da frase ("eu dou 180 naquele boi"). */
const ALIAS_SCORE_CONTAINS = 0.93;

/** Uma variação encontrada e o item a que aponta. */
export interface AliasHit {
  item: Item;
  /** Variação normalizada que casou (ex.: "boi"). */
  alias: string;
  score: number;
}

export interface AliasMatches {
  /** Melhor variação por item (chave = id do item). */
  byItem: Map<string, AliasHit>;
  /** Todas as variações encontradas na mensagem (normalizadas, sem repetir). */
  matched: string[];
}

/** true quando `needle` aparece como sequência contígua de tokens em `haystack`. */
function containsSequence(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  for (let i = 0; i + needle.length <= haystack.length; i++) {
    let found = true;
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) {
        found = false;
        break;
      }
    }
    if (found) return true;
  }
  return false;
}

/**
 * Remove pontuação nas bordas do token ("boi!" → "boi", "vai." → "vai").
 * Só nas bordas: a mensagem pode ter vírgula/ponto colado na palavra e a
 * variação continua sendo a mesma. Nunca mexe no valor ("3." do "3. 110").
 */
function stripEdgePunctuation(token: string): string {
  return token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

/**
 * Procura as variações cadastradas dos itens na mensagem.
 *
 * Duas formas, ambas com normalização única do projeto:
 *  - exata:     "150 no boi"      → nameMsg "boi"  == variação "boi";
 *  - contígua:  "eu dou 180 naquele boi" / "130 na garrafa de café" — a
 *    variação aparece como sequência de tokens dentro do texto, mesmo com
 *    preenchimentos ("na", "de") e palavras ao redor.
 *
 * Variações inativas nunca chegam aqui: o snapshot só envia `active = true`.
 */
export function collectAliasMatches(
  items: Item[],
  nameTokens: string[],
  rawTokens: string[],
): AliasMatches {
  const byItem = new Map<string, AliasHit>();
  const matched: string[] = [];
  // Pontuação só nas bordas ("boi!" → "boi") — variação continua casando.
  const hayName = nameTokens.map(stripEdgePunctuation).filter(Boolean);
  const hayRaw = rawTokens.map(stripEdgePunctuation).filter(Boolean);
  const nameMsg = hayName.join(' ');

  if (nameMsg.length === 0 && hayRaw.length === 0) return { byItem, matched };

  for (const item of items) {
    for (const rawAlias of item.aliases ?? []) {
      const alias = normalizeMessage(String(rawAlias ?? ''));
      if (!alias) continue;
      const aliasTokens = alias
        .split(/\s+/)
        .map(stripEdgePunctuation)
        .filter(Boolean);
      if (aliasTokens.length === 0) continue;

      let score = 0;
      if (aliasTokens.join(' ') === nameMsg) {
        score = ALIAS_SCORE_EXACT;
      } else if (containsSequence(hayRaw, aliasTokens) || containsSequence(hayName, aliasTokens)) {
        score = ALIAS_SCORE_CONTAINS;
      }
      if (score === 0) continue;

      if (!matched.includes(alias)) matched.push(alias);

      const current = byItem.get(item.id);
      if (!current || current.score < score) {
        byItem.set(item.id, { item, alias, score });
      }
    }
  }

  return { byItem, matched };
}

export type AliasDecision =
  | { kind: 'match'; hit: AliasHit }
  | {
      kind: 'ambiguous';
      candidates: Array<{ item: Item; score: number }>;
      matchedText: string | null;
    };

/**
 * Decide o que fazer com as variações encontradas.
 *
 * REGRA: variação cadastrada é evidência forte, mas nunca vence um conflito.
 *  - nenhuma variação            → null (seguir o caminho normal de nomes);
 *  - variação de 1 item          → match, salvo se OUTRO item tiver nome
 *                                  forte na mensagem (≥ ALIAS_COMPETE_MIN);
 *  - variação de 2+ itens        → ambíguo (pergunta o Nº, nunca adivinha).
 */
export function decideWithAlias(
  matches: AliasMatches,
  nameCandidates: Array<{ item: Item; score: number }>,
): AliasDecision | null {
  if (matches.byItem.size === 0) return null;

  const hits = [...matches.byItem.values()];
  const hitItemIds = new Set(hits.map((h) => h.item.id));
  const competitors = nameCandidates.filter(
    (c) => !hitItemIds.has(c.item.id) && c.score >= ALIAS_COMPETE_MIN,
  );

  const all = [
    ...hits.map((h) => ({ item: h.item, score: h.score })),
    ...competitors.map((c) => ({ item: c.item, score: c.score })),
  ];
  const distinctItemIds = new Set(all.map((a) => a.item.id));

  if (distinctItemIds.size > 1) {
    all.sort((a, b) => b.score - a.score);
    const best = hits.reduce((a, b) => (b.score > a.score ? b : a));
    return { kind: 'ambiguous', candidates: all, matchedText: best.alias };
  }

  const best = hits.reduce((a, b) => (b.score > a.score ? b : a));
  return { kind: 'match', hit: best };
}

/**
 * Itens apontados por NÚMEROS soltos na mensagem ("01", "2"), ignorando
 * números que fazem parte do nome. Usado para detectar conflito
 * "número + variação" — dois itens diferentes na mesma frase.
 */
function itemsByNumberTokens(items: Item[], tokens: string[]): Item[] {
  const found: Item[] = [];
  for (const token of tokens) {
    if (!/^\d{1,4}$/.test(token)) continue;
    const number = parseInt(token, 10);
    if (number <= 0) continue;
    const item = items.find((i) => i.order === number);
    if (item && !found.some((f) => f.id === item.id)) found.push(item);
  }
  return found;
}

/**
 * Classifica o nível de correspondência do item.
 */
enum MatchLevel {
  ExactNumber = 'exactNumber',      // "01 25" - número exato
  ExactName = 'exactName',          // "capão 25" - nome exato normalizado
  PartialName = 'partialName',      // correspondência parcial única
  Fuzzy = 'fuzzy',                  // fuzzy matching controlado
  None = 'none'                     // nenhuma correspondência
}

/** Traduz o nível de match do parser para o vocabulário do Confidence Engine. */
function matchedByFromLevel(level: MatchLevel): BidMatchedBy {
  switch (level) {
    case MatchLevel.ExactNumber:
      return 'item_number';
    case MatchLevel.ExactName:
      return 'item_name_exact';
    case MatchLevel.PartialName:
      return 'item_name_partial';
    case MatchLevel.Fuzzy:
      return 'item_name_fuzzy';
    default:
      return 'none';
  }
}

/**
 * Fração dos tokens significativos do item citados na mensagem.
 *
 * "bolo" → item "Bolo de Goma" = 0.5 (citou "bolo", faltou "goma").
 * Nome exato → 1.0. Mensagem sem nome → 0 (sem evidência nenhuma do nome),
 * o que obriga o Confidence Engine a confirmar antes de registrar.
 */
function computeCoverage(item: Item, nameTokens: string[]): number {
  if (nameTokens.length === 0) return 0;
  const itemTokens = stripFillerWords(normalizeItemName(item.name))
    .split(/\s+/)
    .filter(Boolean);
  if (itemTokens.length === 0) return 1;
  const messageTokens = new Set(nameTokens.map((t) => normalizeItemName(t)));
  const hits = itemTokens.filter((t) => messageTokens.has(t)).length;
  return hits / itemTokens.length;
}

/**
 * Pontua uma candidata correspondência de item.
 * Considera: número exato, nome normalizado, tokens coincidentes, etc.
 */
function scoreCandidate(
  item: Item,
  normalizedMsg: string,
  itemTokens: string[],
  hasNumberReference: boolean
): { score: number; level: MatchLevel } {
  let score = 0;
  let level = MatchLevel.None;
  let levelNum = 0; // numeric representation of level

  // Nível 1: Número exato do item
  if (hasNumberReference && item.order.toString() === itemTokens[0]) {
    score = 1.0;
    level = MatchLevel.ExactNumber;
    levelNum = 1;
  }

  // Nível 2: Nome exato normalizado (também aceita quando, removidas as
  // palavras de preenchimento do NOME DO ITEM, sobra exatamente o que o
  // usuário digitou: "bolo goma" casando com "Bolo de Goma").
  const normalizedItemName = normalizeItemName(item.name);
  if (
    normalizedMsg.length > 0 &&
    (normalizedItemName === normalizedMsg ||
      stripFillerWords(normalizedItemName) === normalizedMsg)
  ) {
    score = Math.max(score, 0.95);
    if (levelNum < 2) {
      level = MatchLevel.ExactName;
      levelNum = 2;
    }
  }

  // Nível 3: Tokens coincidentes
  const itemTokenSet = new Set(normalizedItemName.split(' '));
  let tokenMatchCount = 0;
  for (const token of itemTokens) {
    if (itemTokenSet.has(token)) {
      tokenMatchCount++;
    }
  }
  const tokenRatio = itemTokens.length > 0 ? tokenMatchCount / itemTokens.length : 0;
  if (tokenRatio >= 0.6 && tokenMatchCount > 0) {
    const newScore = 0.7 + tokenRatio * 0.15;
    if (score < newScore) {
      score = newScore;
      if (levelNum < 3) {
        level = MatchLevel.PartialName;
        levelNum = 3;
      }
    }
  }

  // Nível 4: Fuzzy matching controlado (pequenas diferenças de digitação).
  // O score pode subir aqui, mas o RÓTULO só vira "fuzzy" quando ainda não
  // havia match exato: um nome/número exato nunca pode ser rebaixado, senão o
  // Confidence Engine passaria a pedir confirmação para frases perfeitamente
  // identificadas ao nome do item.
  const levenshtein = levenshteinDistance(normalizedMsg, normalizedItemName);
  const maxLen = Math.max(normalizedMsg.length, normalizedItemName.length || 1);
  const editRatio = levenshtein / maxLen;
  if (editRatio <= 0.3) {
    const fuzzyScore = 1.0 - editRatio;
    if (score < fuzzyScore) {
      score = fuzzyScore;
      // Não rebaixa match exato (número = 1, nome = 2); todo o resto vira fuzzy.
      if (levelNum !== 1 && levelNum !== 2) {
        level = MatchLevel.Fuzzy;
      }
    }
  }

  return { score, level };
}

/**
 * Calcula distância de edição (Levenshtein) entre duas strings.
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b[i - 1] === a[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Resolve o item pela número (Nível 1 - prioridade máxima).
 * Retorna o item correspondente e o level de match.
 */
function resolveByNumber(
  items: Item[],
  numberStr: string
): { item: Item | null; level: MatchLevel; score: number } {
  const number = parseInt(numberStr, 10);
  if (number <= 0) return { item: null, level: MatchLevel.None, score: 0 };

  // Os itens no snapshot já têm number = index + 1
  // Procuramos pelo item cujo order correspondente ao número
  for (const item of items) {
    if (item.order === number) {
      return { item, level: MatchLevel.ExactNumber, score: 1.0 };
    }
  }

  // Se não encontrou pelo order, tenta verificar se o número está no nome do item
  // Ex: "Capão 01" - o "01" no nome também seria correspondência
  for (const item of items) {
    const normalizedName = normalizeMessage(item.name);
    if (normalizedName.includes(numberStr)) {
      return { item, level: MatchLevel.PartialName, score: 0.6 };
    }
  }

  return { item: null, level: MatchLevel.None, score: 0 };
}

/**
 * Resolve o item pelo nome (Níveis 2-4).
 * Tenta matching em camadas e retorna o melhor candidato.
 */
function resolveByName(
  items: Item[],
  normalizedMsg: string,
  allTokens: string[]
): { item: Item | null; level: MatchLevel; score: number; candidates: Array<{ item: Item; score: number; level: MatchLevel }> } {
  const candidates: Array<{ item: Item; score: number; level: MatchLevel }> = [];

  for (const item of items) {
    const { score, level } = scoreCandidate(item, normalizedMsg, allTokens, false);
    if (score > 0) {
      candidates.push({ item, score, level });
    }
  }

  // Ordena por score decrescente
  candidates.sort((a, b) => b.score - a.score);

  // Retorna o melhor candidato
  const best = candidates.length > 0 ? candidates[0] : { item: null, score: 0, level: MatchLevel.None };

  return { item: best.item, level: best.level, score: best.score, candidates };
}

/**
 * Verifica se há correspondência única e suficiente.
 * Retorna o resultado da resolução ou null se ambíguo.
 */
function checkUniqueMatch(
  items: Item[],
  result: {
    item: Item | null;
    level: MatchLevel;
    score: number;
    candidates: Array<{ item: Item; score: number; level: MatchLevel }>;
  }
): { match: true; item: Item } | { match: false; candidates: Array<{ itemNumber: number; itemName: string; normalizedName: string; score: number }> } {
  const validCandidates = result.candidates.filter(c => c.score >= 0.5);

  if (validCandidates.length === 0) {
    return { match: false, candidates: [] };
  }

  if (validCandidates.length === 1) {
    const c = validCandidates[0];
    return {
      match: true,
      item: c.item
    };
  }

  // Mais de um candidato com boa pontuação - verifica se há um claramente vencedor
  const topScore = validCandidates[0].score;
  const secondScore = validCandidates[1]?.score ?? 0;
  const gap = topScore - secondScore;

  // Se a diferença for significativa (>= 0.2), aceita o vencedor.
  // Nome exato do item (score >= 0.95) também vence desde que não haja empate
  // (dois itens com o mesmo nome normalizado continuam ambíguos).
  if (gap >= 0.2 || (topScore >= 0.95 && gap > 0)) {
    return {
      match: true,
      item: validCandidates[0].item
    };
  }

  // Caso contrário, é ambíguo
  const candidateSummaries = validCandidates.map(c => ({
    itemNumber: c.item.order,
    itemName: c.item.name,
    normalizedName: normalizeMessage(c.item.name),
    score: c.score
  }));

  return {
    match: false,
    candidates: candidateSummaries
  };
}

/**
 * Parser principal de mensagem de lance no modo lista.
 * 
 * Lógica:
 * 1. Normaliza a mensagem
 * 2. Tenta extrair valor monetário
 * 3. Tenta identificar item por número (prioridade máxima)
 * 4. Se falha, tenta por nome
 * 5. Se ainda houver dúvida, verifica contexto pendente
 * 6. Retorna ParsedBidResult com todos os dados necessários
 */
export class ListBidParser {
  constructor(
    private readonly items: Item[] = [],
    private readonly maxCandidates = 3
  ) {}

  /**
   * Define os itens disponíveis no leilão atual.
   * Em produção, viria do listAuctionSnapshot do AuctionEngine.
   */
  setItems(items: Item[]): void {
    this.items.splice(0, this.items.length, ...items);
  }

  /**
   * Parseia uma mensagem de lance no formato lista.
   *
   * Formatos aceitos:
   *  - Nº + valor: "01 300", "1 25,50", "01-300", "01 r$ 300"
   *  - Nome + valor: "capão 300", "25 no capão", "25 na garrafa térmica"
   *  - Valor puro: "300", "R$ 300" (item fica por conta do chamador)
   */
  parseMessage(message: string): ParsedBidResult {
    let normalized = normalizeMessage(message);
    const originalMessage = message.trim();

    // "01-300" / "01 – 300" → "01 300" (separadores entre dígitos)
    normalized = normalized.replace(/(\d)\s*[-–—]\s*(\d)/g, '$1 $2');

    // Inicializa resultado
    const result: ParsedBidResult = {
      originalMessage,
      normalizedMessage: normalized,
      amount: null,
      amountRaw: null,
      itemNumber: null,
      itemId: null,
      itemName: null,
      matchedBy: 'none',
      matchCoverage: 0,
      confidence: 0,
      ambiguous: false,
      candidates: [],
      reason: '',
      needsUserInput: false,
      pendingContextId: undefined
    };

    // Tokens sem o símbolo "r$" solto (ex.: "01 r$ 300")
    const tokens = normalized.split(/\s+/).filter((t) => t.length > 0 && t !== 'r$');

    // --- ETAPA 1: valor + nº do item ---
    let amount: number | null = null;
    let amountRaw: string | null = null;
    let claimedNumber: number | null = null;
    let remainingTokens: string[] = [...tokens];

    // Formato A (prioridade máxima): "Nº VALOR" — "01 300", "1 25,50", "3. 110"
    // O Nº pode vir com pontuação final ("3. 110" / "3, 110"): senão o "3." é
    // lido como valor e "110" vira número de item inexistente.
    if (tokens.length >= 2 && /^\d{1,4}[.,]?$/.test(tokens[0]) && parseInt(tokens[0], 10) > 0) {
      let amt = parseAmount(tokens[1]);
      let consumed = 1;
      if (amt === null || amt <= 0) {
        // multi-token: "01 300 reais" → tenta tudo junto
        amt = parseAmount(tokens.slice(1).join(' '));
        consumed = tokens.length - 1;
      }
      if (amt !== null && amt > 0) {
        claimedNumber = parseInt(tokens[0], 10);
        amount = amt;
        amountRaw = tokens.slice(1).join(' ');
        remainingTokens = tokens.slice(1 + consumed);
      }
    }

    // Formato B: valor em qualquer posição ("capão 300", "25 na garrafa")
    if (amount === null) {
      for (let i = 0; i < tokens.length; i++) {
        const parsed = parseAmount(tokens[i]);
        if (parsed !== null && parsed > 0) {
          amount = parsed;
          amountRaw = tokens[i];
          remainingTokens = tokens.filter((_, idx) => idx !== i);
          break;
        }
      }
    }

    result.amount = amount;
    result.amountRaw = amountRaw;

    // Remove palavras de preenchimento ("no", "na", "dou"...) do que sobrou
    const nameTokens = stripFillerWords(remainingTokens.join(' ')).split(/\s+/).filter(Boolean);
    const nameMsg = nameTokens.join(' ');

    // --- ETAPA 2: Identificação do item ---
    let itemNumber: number | null = null;
    let itemId: string | null = null;
    let itemName: string | null = null;
    let matchScore = 0;
    let ambiguous = false;
    let candidates: Array<{ itemNumber: number; itemName: string; normalizedName: string; score: number }> = [];
    let needsUserInput = false;
    let matchedBy: BidMatchedBy = 'none';
    let matchCoverage = 0;
    let matchedText: string | null = null;
    let reasonOverride: string | null = null;

    const toCandidate = (item: Item, score: number) => ({
      itemNumber: item.order,
      itemName: item.name,
      normalizedName: normalizeItemName(item.name),
      score,
    });

    if (amount !== null && amount > 0) {
      if (claimedNumber !== null) {
        // Formato A: o nº veio explícito — resolve só por número
        const r = resolveByNumber(this.items, String(claimedNumber));
        if (r.item) {
          const numberItem = r.item;
          // Número + variação de OUTRO item ("01 180 na garrafa"): dois itens
          // na mesma frase → conflito. O nº explícito não pode ser ignorado e a
          // variação não pode sobrescrevê-lo: pergunta ao participante.
          const aliasConflicts = [
            ...collectAliasMatches(this.items, nameTokens, remainingTokens).byItem.values(),
          ].filter((hit) => hit.item.id !== numberItem.id);

          if (aliasConflicts.length > 0) {
            ambiguous = true;
            needsUserInput = true;
            matchedBy = 'item_alias';
            matchedText = aliasConflicts.map((c) => c.alias).join(', ');
            candidates = [
              toCandidate(r.item, r.score),
              ...aliasConflicts.map((c) => toCandidate(c.item, c.score)),
            ].slice(0, this.maxCandidates);
            reasonOverride =
              `Nº ${claimedNumber} conflita com a variação "${matchedText}" ` +
              `do item ${aliasConflicts[0].item.order} • ${aliasConflicts[0].item.name}; ` +
              'participante deve escolher o item.';
          } else {
            itemNumber = r.item.order;
            itemId = r.item.id;
            itemName = r.item.name;
            matchScore = r.score;
            candidates = [toCandidate(r.item, r.score)];
            matchedBy = matchedByFromLevel(r.level);
            matchCoverage = matchedBy === 'item_number' ? 1 : computeCoverage(r.item, nameTokens);
          }
        } else {
          // Nº alegado não existe na lista (o chamador orienta o usuário)
          itemNumber = claimedNumber;
        }
      } else if (nameTokens.length > 0) {
        // Só nº puro depois do valor ("300 no 02", "25 02") → resolve por número.
        // Se há nome junto ("25 no capão 01"), o nome tem prioridade — nunca
        // arriscar registrar no item errado.
        const allNumeric = nameTokens.every((t) => /^\d{1,4}$/.test(t));
        let resolved = false;
        if (allNumeric) {
          const r = resolveByNumber(this.items, nameTokens[nameTokens.length - 1]);
          if (r.item) {
            itemNumber = r.item.order;
            itemId = r.item.id;
            itemName = r.item.name;
            matchScore = r.score;
            candidates = [toCandidate(r.item, r.score)];
            matchedBy = matchedByFromLevel(r.level);
            matchCoverage = matchedBy === 'item_number' ? 1 : computeCoverage(r.item, nameTokens);
            resolved = true;
          }
        }

        if (!resolved) {
          // Variações cadastradas pelo administrador são evidência forte e
          // entram ANTES da comparação por nome: "150 no boi" → "Garrote".
          const aliasMatches = collectAliasMatches(this.items, nameTokens, remainingTokens);
          const nameResult = resolveByName(this.items, nameMsg, nameTokens);
          const aliasDecision = decideWithAlias(aliasMatches, nameResult.candidates);

          if (aliasDecision) {
            const poolItems: Item[] =
              aliasDecision.kind === 'match'
                ? [aliasDecision.hit.item]
                : aliasDecision.candidates.map((c) => c.item);
            // Número solto que aponta para OUTRO item ("150 boi 02") também é
            // conflito: dois itens na mesma frase → perguntar, nunca tentar.
            const numberConflicts = itemsByNumberTokens(this.items, nameTokens).filter(
              (item) => !poolItems.some((p) => p.id === item.id),
            );

            matchedText =
              aliasDecision.kind === 'match'
                ? aliasDecision.hit.alias
                : aliasDecision.matchedText;

            if (aliasDecision.kind === 'ambiguous' || numberConflicts.length > 0) {
              ambiguous = true;
              needsUserInput = true;
              matchedBy = 'item_alias';

              const pool =
                aliasDecision.kind === 'ambiguous'
                  ? [...aliasDecision.candidates]
                  : [{ item: aliasDecision.hit.item, score: aliasDecision.hit.score }];
              for (const item of numberConflicts) {
                if (!pool.some((p) => p.item.id === item.id)) pool.push({ item, score: 1.0 });
              }
              pool.sort((a, b) => b.score - a.score);
              candidates = pool.slice(0, this.maxCandidates).map((p) => toCandidate(p.item, p.score));
              reasonOverride =
                `Variação "${matchedText}" e/ou nº da mensagem apontam para ` +
                `${candidates.length} itens; participante deve escolher.`;
            } else {
              const hit = aliasDecision.hit;
              itemNumber = hit.item.order;
              itemId = hit.item.id;
              itemName = hit.item.name;
              matchScore = hit.score;
              matchedBy = 'item_alias';
              matchCoverage = 1;
              candidates = [toCandidate(hit.item, hit.score)];
            }
          } else {
            const uniqueMatch = checkUniqueMatch(this.items, nameResult);

            if (uniqueMatch.match) {
              itemNumber = uniqueMatch.item.order;
              itemId = uniqueMatch.item.id;
              itemName = uniqueMatch.item.name;
              const matchedCandidate = nameResult.candidates.find(
                (c) => c.item === uniqueMatch.item,
              );
              matchScore = matchedCandidate?.score ?? 0.5;
              matchedBy = matchedByFromLevel(matchedCandidate?.level ?? MatchLevel.None);
              matchCoverage = computeCoverage(uniqueMatch.item, nameTokens);
              candidates = nameResult.candidates
                .filter((c) => c.score >= 0.5)
                .slice(0, this.maxCandidates)
                .map((c) => toCandidate(c.item, c.score));
            } else if (uniqueMatch.candidates.length > 0) {
              // Ambíguo — vários itens parecidos: NUNCA escolhe sozinho
              ambiguous = true;
              candidates = uniqueMatch.candidates.slice(0, this.maxCandidates);
              needsUserInput = true;
            } else {
              // Valor ok, mas nenhum item reconhecido
              ambiguous = true;
              needsUserInput = true;
            }
          }
        }
      }
    }

    // --- ETAPA 3: Montagem do resultado final ---

    // Calcula confiança geral (valor + item + qualidade do match)
    let confidence = 0;
    if ((amount ?? 0) > 0 && itemId) {
      confidence = (0.95 + 0.9 + matchScore) / 3;
    } else if ((amount ?? 0) > 0) {
      confidence = 0.7; // Só valor, item não identificado
    } else if (itemId) {
      confidence = 0.6; // Só item, valor não identificado
    }

    // Determina se precisa de entrada do usuário
    if (ambiguous || (candidates.length > 0 && candidates[0].score < 0.5)) {
      needsUserInput = true;
    }

    // Monta motivo legível
    if (reasonOverride) {
      result.reason = reasonOverride;
    } else if (ambiguous && candidates.length > 0) {
      result.reason = `Lance de R$ ${formatAmount(amount ?? 0)} identificado, mas ${candidates.length} item(ns) correspondem: ${candidates.map((c) => `${c.itemNumber} • ${c.itemName}`).join(', ')}`;
    } else if (itemId && amount && matchedBy === 'item_alias') {
      result.reason = `Lance de R$ ${formatAmount(amount)} no item ${itemNumber} • ${itemName} (variação "${matchedText}")`;
    } else if (itemId && amount) {
      result.reason = `Lance de R$ ${formatAmount(amount)} no item ${itemNumber} • ${itemName}`;
    } else if ((amount ?? 0) > 0 && itemNumber !== null && !itemId) {
      result.reason = `Item ${itemNumber} não encontrado na lista`;
    } else if ((amount ?? 0) > 0) {
      result.reason = `Valor R$ ${formatAmount(amount ?? 0)} identificado, mas item não reconhecido`;
    } else {
      result.reason = 'Não foi possível identificar valor ou item na mensagem';
    }

    // Preenche o resultado
    result.ambiguous = ambiguous;
    result.confidence = Math.min(confidence, 1.0);
    result.candidates = candidates.slice(0, this.maxCandidates);
    result.itemNumber = itemNumber;
    result.itemId = itemId;
    result.itemName = itemName;
    result.matchedBy = matchedBy;
    result.matchedText = matchedText;
    result.matchCoverage = Math.min(Math.max(matchCoverage, 0), 1);
    result.needsUserInput = needsUserInput;

    return result;
  }
}

/** Normaliza um nome de item para comparação (minúsculas, sem acentos). */
function normalizeItemName(name: string): string {
  return normalizeMessage(name);
}

/**
 * Formata o valor monetário (em reais) para exibição.
 */
function formatAmount(amount: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(amount);
}

/**
 * Cria um parser pronto com itens do leilão.
 * Em produção, os itens vem do listAuctionSnapshot.
 */
export function createParser(items: Item[]): ListBidParser {
  const parser = new ListBidParser(items);
  return parser;
}