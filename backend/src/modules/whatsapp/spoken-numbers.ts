/**
 * Conversão de números falados (pt-BR) para dígitos.
 *
 * Usado apenas na normalização de TRANSCRIÇÕES de áudio: "Dou cinquenta reais
 * no bolo de goma" -> "Dou 50 reais no bolo de goma". Mensagens digitadas não
 * passam por aqui (nenhum comportamento de texto existente é alterado).
 *
 * Regras:
 *  - unidades/dezenas/centenas/escalas com o conectivo "e"
 *    ("vinte e cinco" = 25, "cento e vinte" = 120, "mil e quinhentos" = 1500);
 *  - uma sequência só é convertida quando faz sentido como valor de lance:
 *    valor >= 2, ou há marcador monetário por perto ("reais", "lance"), ou
 *    `force` está ativo (resposta de item: "a número um");
 *  - palavra de escala sozinha ("mil") só converte quando o contexto é de
 *    lance — evita transformar nomes de item como "Bolo de Mil Folhas".
 *
 * A função NUNCA adivinha: o que não for número permanece intacto.
 */

type WordDict = Record<string, number>;

const UNITS: WordDict = {
  zero: 0,
  um: 1,
  uma: 1,
  uns: 1,
  umas: 1,
  dois: 2,
  duas: 2,
  tres: 3,
  quatro: 4,
  cinco: 5,
  seis: 6,
  sete: 7,
  oito: 8,
  nove: 9,
  dez: 10,
  onze: 11,
  doze: 12,
  treze: 13,
  catorze: 14,
  quinze: 15,
  dezesseis: 16,
  dezessete: 17,
  dezoito: 18,
  dezenove: 19,
};

const TENS: WordDict = {
  vinte: 20,
  trinta: 30,
  quarenta: 40,
  cinquenta: 50,
  sessenta: 60,
  setenta: 70,
  oitenta: 80,
  noventa: 90,
};

const HUNDREDS: WordDict = {
  cem: 100,
  cento: 100,
  duzentos: 200,
  duzentas: 200,
  trezentos: 300,
  trezentas: 300,
  quatrocentos: 400,
  quatrocentas: 400,
  quinhentos: 500,
  quinhentas: 500,
  seiscentos: 600,
  seiscentas: 600,
  setecentos: 700,
  setecentas: 700,
  oitocentos: 800,
  oitocentas: 800,
  novecentos: 900,
  novecentas: 900,
};

const SCALES: WordDict = {
  mil: 1000,
  milhar: 1000,
  milhao: 1000000,
  milhoes: 1000000,
  bilhao: 1000000000,
  bilhoes: 1000000000,
};

const JOINER = 'e';

/** Palavras que indicam contexto monetário ao lado da sequência numérica. */
const MONEY_MARKERS = new Set([
  'real',
  'reais',
  'lance',
  'lances',
  'conto',
  'contos',
  'dinheiro',
]);

/**
 * Palavras que, vindo depois de uma escala isolada ("mil"), indicam contexto de
 * lance ("dou mil no capão") em vez de nome de item ("Bolo de Mil Folhas").
 */
const LANCE_CONTEXT = new Set([
  'no',
  'na',
  'nos',
  'nas',
  'em',
  'de',
  'do',
  'da',
  'dos',
  'das',
  'por',
  'para',
  'pra',
  'pro',
  'com',
  'o',
  'a',
  'os',
  'as',
  'num',
  'numa',
  'este',
  'esta',
  'esse',
  'essa',
  'este',
  'aquele',
  'aquela',
  'naquele',
  'naquela',
  'reais',
  'real',
  'lance',
  'lances',
]);

export interface SpokenNumbersOptions {
  /**
   * Converte sequências com valor 1 ("um", "uma") mesmo sem marcador
   * monetário. Usado ao responder "qual item?" ("a número um").
   */
  force?: boolean;
}

/** Remove acentos e deixa em minúsculas (comparação normalizada). */
export function stripAccents(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/** Chave de comparação de um token: sem acento, sem pontuação nas bordas. */
function tokenKey(token: string): string {
  return stripAccents(token).replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
}

function isNumberWord(key: string): boolean {
  return (
    Object.prototype.hasOwnProperty.call(UNITS, key) ||
    Object.prototype.hasOwnProperty.call(TENS, key) ||
    Object.prototype.hasOwnProperty.call(HUNDREDS, key) ||
    Object.prototype.hasOwnProperty.call(SCALES, key)
  );
}

function hasWord(dict: WordDict, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(dict, key);
}

/** Pontuação que encerra um número falado ("dois,", "quatrocentos."). */
const RUN_TERMINATOR = /[,.;:!?]$/;

/**
 * Soma uma sequência de palavras numéricas já normalizadas.
 *
 * "vinte" "e" "cinco" => 25
 * "cento" "e" "vinte" => 120
 * "mil" "e" "quinhentos" => 1500
 * "dois" "mil" => 2000
 */
export function parseNumberWords(words: string[]): number | null {
  if (words.length === 0) return null;

  let total = 0;
  let current = 0;

  for (const raw of words) {
    const word = raw.toLowerCase();
    if (word === JOINER) continue; // conectivo: "vinte E cinco"

    if (Object.prototype.hasOwnProperty.call(UNITS, word)) {
      current += UNITS[word];
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(TENS, word)) {
      current += TENS[word];
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(HUNDREDS, word)) {
      current += HUNDREDS[word];
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(SCALES, word)) {
      const base = current > 0 ? current : 1;
      total += base * SCALES[word];
      current = 0;
      continue;
    }
    return null;
  }

  return total + current;
}

/**
 * Divide um token hifenizado quando TODAS as partes são palavras numéricas
 * ("vinte-e-cinco"). Nomes com hífen ("Blusa-corta-vento") ficam intactos.
 */
function splitNumericHyphen(token: string): string[] {
  if (!token.includes('-')) return [token];
  const parts = token.split('-');
  if (parts.length < 2) return [token];
  const keys = parts.map(tokenKey);
  const numeric = keys.every((key) => isNumberWord(key) || key === JOINER);
  return numeric ? parts : [token];
}

/** Preserva a pontuação das bordas ao substituir a sequência por dígitos. */
function replaceRun(run: string[], digits: string): string {
  const first = run[0];
  const last = run[run.length - 1];
  const leading = /^[^a-z0-9]*/i.exec(first)?.[0] ?? '';
  const trailing = /[^a-z0-9]*$/i.exec(last)?.[0] ?? '';
  return `${leading}${digits}${trailing}`;
}

/**
 * Converte números falados de pt-BR em dígitos, preservando o restante do
 * texto. Sequências sem valor plausível de lance são deixadas como estão.
 */
export function spokenNumbersToDigits(
  text: string,
  options: SpokenNumbersOptions = {},
): string {
  const force = options.force === true;
  if (!text || !/\p{L}/u.test(text)) return text;

  const rawTokens = text.split(/\s+/).filter(Boolean);
  const tokens: string[] = [];
  for (const token of rawTokens) tokens.push(...splitNumericHyphen(token));

  const out: string[] = [];
  let index = 0;

  while (index < tokens.length) {
    const key = tokenKey(tokens[index]);
    if (!isNumberWord(key)) {
      out.push(tokens[index]);
      index += 1;
      continue;
    }

    // Sequência máxima de palavras numéricas (o conectivo "e" só conta quando
    // há número antes e depois).
    let end = index;
    let sawNumber = false;
    while (end < tokens.length) {
      const rawToken = tokens[end];
      const currentKey = tokenKey(rawToken);
      if (isNumberWord(currentKey)) {
        // Unidade/dezena imediatamente seguida de centena SEM conectivo
        // ("dois quatrocentos") não é como o pt-BR forma 402 (seria
        // "quatrocentos e dois"): são dois números distintos na frase
        // (nº do item + valor), então a sequência termina antes dela.
        const prevKey = end > index ? tokenKey(tokens[end - 1]) : '';
        const prevIsUnitOrTen = hasWord(UNITS, prevKey) || hasWord(TENS, prevKey);
        if (end > index && hasWord(HUNDREDS, currentKey) && prevIsUnitOrTen) {
          break;
        }
        sawNumber = true;
        end += 1;
        // "dois, quatrocentos" é item + valor; pontuação final encerra o
        // número para não somar os dois num só (viraria 402).
        if (RUN_TERMINATOR.test(rawToken)) break;
        continue;
      }
      if (
        currentKey === JOINER &&
        sawNumber &&
        end + 1 < tokens.length &&
        isNumberWord(tokenKey(tokens[end + 1]))
      ) {
        end += 1;
        continue;
      }
      break;
    }

    const run = tokens.slice(index, end);
    const value = parseNumberWords(run.map(tokenKey));
    const scaleOnly = run.length === 1 && Object.prototype.hasOwnProperty.call(SCALES, tokenKey(run[0]));

    const before = index > 0 ? tokenKey(tokens[index - 1]) : '';
    const after = end < tokens.length ? tokenKey(tokens[end]) : '';
    const moneyNear =
      (before && MONEY_MARKERS.has(before)) || (after && MONEY_MARKERS.has(after));
    const lanceContext = after === '' || LANCE_CONTEXT.has(after);

    const convert =
      value !== null &&
      (force || value >= 2 || moneyNear) &&
      (!scaleOnly || moneyNear || lanceContext);

    if (convert) {
      out.push(replaceRun(run, String(value)));
      index = end;
      continue;
    }

    out.push(tokens[index]);
    index += 1;
  }

  return out.join(' ');
}
