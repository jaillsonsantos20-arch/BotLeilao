import { BidMatchedBy, ParsedBidResult } from './list-bid.parser';
import { BidSource } from './whatsapp.types';

/**
 * Confidence Engine — decide o que fazer com uma mensagem interpretada.
 *
 * Três níveis (nunca mais, nunca menos):
 *
 *   1. ALTA confiança  → `register`   registra direto (rápido e simples)
 *   2. CONFIANÇA       → `confirm`    "Entendi X, confirma?" (2 min, só o autor)
 *   3. AMBIGUIDADE     → `clarify`    "Qual item?" (nunca escolhe por conta própria)
 *
 * Além dos três, há dois desfechos neutros: `orient_number` / `orient_format`
 * (orienta o participante) e `ignore` (conversa normal, silêncio absoluto).
 *
 * REGRA DE OURO: nunca escolher um item arbitrariamente. A decisão é uma função
 * pura de (parser, origem da mensagem, contexto) — testável sem I/O.
 *
 * A origem da mensagem (texto digitado x áudio transcrito) NÃO muda os
 * limites: o áudio entra no mesmo pipeline, com as mesmas regras. O que muda é
 * a qualidade da transcrição, quando o provedor a informa — ver
 * `applyTranscriptionQuality`.
 */
export type BidDecision =
  | 'register'
  | 'confirm'
  | 'clarify'
  | 'orient_number'
  | 'orient_format'
  | 'ignore';

export interface ConfidenceInput {
  parsed: ParsedBidResult;
  source: BidSource;
  /** true quando o item veio da mensagem citada ("Responder") e não do texto. */
  replyContextUsed: boolean;
  /** Heurística atual: texto começa com valor/cifrão ou é só valor após fillers. */
  looksLikeBid: boolean;
  /** Qualidade 0..1 do provedor de transcrição, quando disponível. */
  transcriptionQuality?: number | null;
  /**
   * Sinais do contexto de disputa ativa dos ITENS (contexto automático).
   * Só é calculado quando o texto tem valor e NENHUM item explícito/resposta.
   */
  activeContext?: ActiveBidContextSignal | null;
}

/** Item cuja disputa está ativa e cujo valor aceita o lance em análise. */
export interface ActiveBidContextCandidate {
  auctionId: string;
  itemId: string | null;
  itemNumber: number;
  itemName: string;
  lastBidAmount: number;
  lastBidAt: number;
  lastBidId: string | null;
}

/**
 * Sinais do contexto de disputa ativa (uma entrada por item, isolado por
 * tenant + grupo + leilão + item).
 */
export interface ActiveBidContextSignal {
  /** Contextos ativos compatíveis com o valor do novo lance (0, 1 ou N). */
  candidates: ActiveBidContextCandidate[];
  /** Contextos ativos descartados apenas porque o valor não cresceu. */
  blockedByValue: number;
  /** Contextos ativos considerados (candidatos + bloqueados). */
  totalActive: number;
  /** Idade (ms) do lance mais recente entre os candidatos. */
  newestAgeMs: number;
}

export interface ConfidenceAssessment {
  decision: BidDecision;
  /** Confiança final 0..1 (gravada na auditoria). */
  confidence: number;
  matchedBy: BidMatchedBy;
  source: BidSource;
  /** Motivo legível para auditoria/logs. */
  reason: string;
  /**
   * Quando a ambiguidade vem dos contextos de disputa (e não do texto), são
   * estes os itens que devem ser oferecidos na pergunta "Para qual item?".
   */
  clarifyOptions?: Array<{ itemNumber: number; itemName: string }>;
}

/** Cobertura mínima do nome do item para registrar sem confirmar (nome parcial). */
export const PARTIAL_COVERAGE_REGISTER_MIN = 0.5;

/** Abaixo desta qualidade de transcrição, nada é registrado sem confirmação. */
export const TRANSCRIPTION_QUALITY_CONFIRM_MAX = 0.7;

// ---------------------------------------------------------------------------
// Contexto de disputa ativa (contexto automático por item)
// ---------------------------------------------------------------------------

/** Confiança base do contexto de disputa: item + valor derivados de lance recente. */
const ACTIVE_CONTEXT_BASE = 0.88;
/** Disputa "quente": lance nos últimos 60s. */
const ACTIVE_CONTEXT_HOT_MS = 60_000;
/** Disputa "morna": lance nos últimos 120s (fora disso é contexto "frio"). */
const ACTIVE_CONTEXT_WARM_MS = 120_000;
/** Bônus quando é a ÚNICA disputa ativa do grupo (não há outro item para disputar). */
const ACTIVE_CONTEXT_UNIQUE_BONUS = 0.02;
/** Teto: contexto nunca vira certeza absoluta. */
const ACTIVE_CONTEXT_MAX = 0.95;
/** Acima disso o contexto é forte o bastante para registrar sem perguntar. */
export const ACTIVE_CONTEXT_REGISTER_MIN = 0.9;
/** Abaixo disso (contexto com incerteza) o lance pede confirmação. */
export const ACTIVE_CONTEXT_CONFIRM = 0.8;

/**
 * Confiança do contexto de disputa, calculada a partir dos sinais reais:
 * recência do lance, quantidade de disputas simultâneas e conflito de valor.
 * Nada de número fixo sem justificativa.
 */
export function activeContextConfidence(signal: ActiveBidContextSignal): number {
  let confidence = ACTIVE_CONTEXT_BASE;
  if (signal.newestAgeMs <= ACTIVE_CONTEXT_HOT_MS) confidence += 0.04;
  else if (signal.newestAgeMs <= ACTIVE_CONTEXT_WARM_MS) confidence += 0.02;
  if (signal.totalActive === 1) confidence += ACTIVE_CONTEXT_UNIQUE_BONUS;
  return Math.min(Math.max(confidence, 0), ACTIVE_CONTEXT_MAX);
}


const CONFIDENCE_BY_MATCH: Record<string, number> = {
  reply_context: 0.97,
  item_number: 0.97,
  // Variação cadastrada pelo administrador: evidência forte (fica atrás só do
  // Nº explícito e do reply), mas o parser já devolve `ambiguous` quando dois
  // itens disputam o mesmo termo — aqui nunca chega conflito.
  item_alias: 0.96,
  item_name_exact: 0.95,
  item_name_partial: 0.9,
};

const CONFIDENCE_CONFIRM = 0.75;
const CONFIDENCE_CLARIFY = 0.5;
const CONFIDENCE_ORIENT = 0.4;

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/**
 * Avalia a interpretação e devolve a decisão.
 * Função pura: não registra lance, não envia mensagem, não lê estado.
 */
export function evaluateBidConfidence(input: ConfidenceInput): ConfidenceAssessment {
  const { parsed, source, replyContextUsed, looksLikeBid } = input;

  const base = (
    decision: BidDecision,
    confidence: number,
    reason: string,
    matchedBy?: BidMatchedBy,
  ): ConfidenceAssessment => ({
    decision,
    confidence: Math.min(Math.max(confidence, 0), 1),
    matchedBy: matchedBy ?? parsed.matchedBy,
    source,
    reason,
  });

  // --- 0) Sem valor identificado: não há lance a considerar ---
  if (parsed.amount === null || parsed.amount <= 0) {
    // Começa com dígito mas não virou valor de lance → orienta o formato.
    if (/^\s*\d/.test(parsed.normalizedMessage)) {
      return base('orient_format', CONFIDENCE_ORIENT, 'Mensagem começa com número, mas não formou um valor de lance.');
    }
    return base('ignore', 0, 'Sem valor de lance na mensagem.');
  }

  // --- 1) Responder do WhatsApp: item veio da mensagem citada (nível máximo) ---
  if (replyContextUsed) {
    return {
      decision: 'register',
      confidence: CONFIDENCE_BY_MATCH.reply_context,
      matchedBy: 'reply_context',
      source,
      reason: 'Item identificado pela mensagem citada (Responder).',
    };
  }

  // --- 2) Item resolvido pelo interpretador ---
  if (parsed.itemId) {
    if (parsed.ambiguous) {
      // Defensivo: item + ambiguidade não coexistem no parser atual.
      return base('clarify', CONFIDENCE_CLARIFY, 'Item candidato ambíguo; participante precisa escolher.');
    }

    const coverage = parsed.matchCoverage;
    const coverageText = `cobertura ${pct(coverage)}`;

    switch (parsed.matchedBy) {
      case 'item_number':
        return base('register', CONFIDENCE_BY_MATCH.item_number, 'Nº do item explícito na mensagem.');
      case 'item_alias':
        return base(
          'register',
          CONFIDENCE_BY_MATCH.item_alias,
          parsed.matchedText
            ? `Correspondência exata com variação cadastrada para o item ("${parsed.matchedText}").`
            : 'Correspondência exata com variação cadastrada para o item.',
        );
      case 'item_name_exact':
        return base('register', CONFIDENCE_BY_MATCH.item_name_exact, 'Nome do item idêntico ao da lista.');
      case 'item_name_partial':
        if (coverage >= PARTIAL_COVERAGE_REGISTER_MIN) {
          return base('register', CONFIDENCE_BY_MATCH.item_name_partial, `Nome parcial único (${coverageText}).`);
        }
        return base('confirm', CONFIDENCE_CONFIRM, `Nome parcial fraco (${coverageText}); confirmação antes de registrar.`);
      case 'item_name_fuzzy':
        return base('confirm', CONFIDENCE_CONFIRM, 'Nome parecido com erro de digitação/transcrição; confirmação antes de registrar.');
      default:
        return base('confirm', CONFIDENCE_CONFIRM, 'Item resolvido sem origem identificável; confirmação antes de registrar.');
    }
  }

  // --- 3) Nº alegado não existe na lista ("99 300") ---
  if (parsed.itemNumber !== null) {
    return base('orient_number', CONFIDENCE_ORIENT, `Item ${parsed.itemNumber} não existe na lista.`);
  }

  // --- 4) Ambiguidade real: vários itens parecidos (nunca escolher) ---
  if (parsed.ambiguous && parsed.candidates.length > 0) {
    return base('clarify', CONFIDENCE_CLARIFY, `${parsed.candidates.length} item(ns) correspondem; participante deve escolher.`);
  }

  // --- 5) Contexto de disputa ativa do item ("165" sem repetir o nome) ---
  //
  // Só chega aqui quando o texto NÃO trouxe item (explícito, citado ou
  // pendente): contexto nunca sobrescreve informação explícita.
  const activeSignal = input.activeContext;
  if (activeSignal && activeSignal.candidates.length > 0) {
    // Dois itens em disputa: nunca escolher por conta própria.
    if (activeSignal.candidates.length > 1) {
      return {
        decision: 'clarify',
        confidence: CONFIDENCE_CLARIFY,
        matchedBy: 'active_bid_context',
        source,
        reason: `${activeSignal.candidates.length} itens com disputa ativa recente; participante deve escolher.`,
        clarifyOptions: activeSignal.candidates.map((c) => ({
          itemNumber: c.itemNumber,
          itemName: c.itemName,
        })),
      };
    }

    const confidence = activeContextConfidence(activeSignal);

    // Valor compatível só com um item, mas outro item tem valor atual que não
    // aceita este lance: incerteza → confirmação (nunca registro direto).
    if (activeSignal.blockedByValue > 0) {
      return base(
        'confirm',
        Math.min(confidence, ACTIVE_CONTEXT_CONFIRM),
        `Disputa recente em 1 item, mas ${activeSignal.blockedByValue} outro(s) item(s) não aceita(m) este valor; confirmação antes de registrar.`,
        'active_bid_context',
      );
    }

    if (confidence >= ACTIVE_CONTEXT_REGISTER_MIN) {
      return base(
        'register',
        confidence,
        'Item deduzido da disputa ativa recente (contexto único, sem conflito).',
        'active_bid_context',
      );
    }

    return base(
      'confirm',
      Math.min(confidence, ACTIVE_CONTEXT_CONFIRM),
      'Contexto de disputa antigo/incerto; confirmação antes de registrar.',
      'active_bid_context',
    );
  }

  // --- 6) Valor sem item, mas a mensagem parece um lance ---
  if (looksLikeBid) {
    return base('clarify', CONFIDENCE_CLARIFY, 'Valor identificado sem item; pedir o item.');
  }

  // --- 6) Começa com número fora do formato → orienta o formato ---
  if (/^\s*\d/.test(parsed.normalizedMessage)) {
    return base('orient_format', CONFIDENCE_ORIENT, 'Mensagem numérica fora do formato de lance.');
  }

  // --- 7) Conversa normal ---
  return base('ignore', 0, 'Mensagem não parece um lance.');
}

/**
 * Aplica a qualidade da transcrição: se o provedor disse que o áudio foi mal
 * entendido, nenhuma decisão `register` é mantida — vira `confirm`. Ambiguidade
 * (`clarify`) permanece ambiguidade: confirmar sem item escolhido não existe.
 */
export function applyTranscriptionQuality(
  assessment: ConfidenceAssessment,
  quality: number | null | undefined,
): ConfidenceAssessment {
  if (quality === null || quality === undefined || !Number.isFinite(quality)) return assessment;
  if (quality >= TRANSCRIPTION_QUALITY_CONFIRM_MAX) return assessment;
  if (assessment.decision !== 'register') return assessment;

  return {
    ...assessment,
    decision: 'confirm',
    confidence: Math.min(assessment.confidence, CONFIDENCE_CONFIRM),
    reason: `${assessment.reason} [transcrição de baixa qualidade: ${pct(quality)}]`,
  };
}
