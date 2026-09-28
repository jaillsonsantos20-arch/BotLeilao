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
}

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
 * Normaliza a mensagem: lowercase, remove acentos, normaliza espaços.
 */
function normalizeMessage(message: string): string {
  let result = message.toLowerCase();
  // Remove acentos via normalização NFD
  result = result.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  // Colapsa múltiplos espaços e trim
  result = result.replace(/\s+/g, ' ').trim();
  return result;
}

/**
 * Remove palavras comuns que não são essenciais para identificação:
 * "r$", "real", "reais", "lance", "dou", "no", "na", "pro", "para"
 * Estas são removidas apenas quando não impedirem a identificação do item.
 */
function stripFillerWords(message: string): string {
  const fillerWords = ['r$', 'real', 'reais', 'lance', 'dou', 'no', 'na', 'pro', 'para'];
  return message
    .split(/\s+/)
    .filter(token => !fillerWords.includes(token.toLowerCase()))
    .join(' ');
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

  // Nível 2: Nome exato normalizado
  const normalizedItemName = item.name.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (normalizedItemName === normalizedMsg) {
    score = Math.max(score, 0.95);
    if (levelNum < 2) {
      level = MatchLevel.ExactName;
      levelNum = 2;
    }
  }

  // Nível 3: Tokens coincidentes
  const itemTokenSet = new Set(item.name.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .split(' '));
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

  // Nível 4: Fuzzy matching controlado (pequenas diferenças de digitação)
  // Verifica se a distância de edição é pequena
  const levenshtein = levenshteinDistance(normalizedMsg, normalizedItemName);
  const maxLen = Math.max(normalizedMsg.length, normalizedItemName.length || 1);
  const editRatio = levenshtein / maxLen;
  if (editRatio <= 0.3) { // até 30% de diferença
    const fuzzyScore = 1.0 - editRatio;
    if (score < fuzzyScore) {
      score = fuzzyScore;
      if (levelNum < 4) {
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
    const normalizedName = item.name.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ');
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
    normalizedName: c.item.name.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' '),
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

    // Formato A (prioridade máxima): "Nº VALOR" — "01 300", "1 25,50"
    if (tokens.length >= 2 && /^\d{1,4}$/.test(tokens[0]) && parseInt(tokens[0], 10) > 0) {
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
          itemNumber = r.item.order;
          itemId = r.item.id;
          itemName = r.item.name;
          matchScore = r.score;
          candidates = [toCandidate(r.item, r.score)];
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
            resolved = true;
          }
        }

        if (!resolved) {
          // Nome (níveis 2-4: exato, tokens, fuzzy)
          const nameResult = resolveByName(this.items, nameMsg, nameTokens);
          const uniqueMatch = checkUniqueMatch(this.items, nameResult);

          if (uniqueMatch.match) {
            itemNumber = uniqueMatch.item.order;
            itemId = uniqueMatch.item.id;
            itemName = uniqueMatch.item.name;
            matchScore =
              nameResult.candidates.find((c) => c.item === uniqueMatch.item)?.score ?? 0.5;
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
    if (ambiguous && candidates.length > 0) {
      result.reason = `Lance de R$ ${formatAmount(amount ?? 0)} identificado, mas ${candidates.length} item(ns) correspondem: ${candidates.map((c) => `${c.itemNumber} • ${c.itemName}`).join(', ')}`;
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
    result.needsUserInput = needsUserInput;

    return result;
  }
}

/** Normaliza um nome de item para comparação (lowercase + sem acentos). */
function normalizeItemName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
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