/**
 * Local, offline text analysis for the PDF Summarizer and Ask Your PDF tools.
 *
 * Everything here is pure text in / plain data out: no DOM, no network, no
 * model download, no npm dependency. The same code runs in the browser and in
 * the Node unit tests, which is what lets these two tools keep the app's
 * "nothing leaves your device" promise by default.
 */

// A compact English stoplist. Long enough to keep scoring honest, short enough
// to stay readable and auditable.
const STOPWORDS = new Set([
  "a", "about", "above", "after", "again", "against", "all", "also", "am", "an", "and", "any", "are", "aren",
  "as", "at", "be", "because", "been", "before", "being", "below", "between", "both", "but", "by", "can",
  "cannot", "could", "did", "do", "does", "doing", "don", "down", "during", "each", "either", "few", "for",
  "from", "further", "had", "has", "have", "having", "he", "her", "here", "hers", "herself", "him", "himself",
  "his", "how", "however", "i", "if", "in", "into", "is", "it", "its", "itself", "just", "let", "like", "may",
  "me", "might", "more", "most", "much", "must", "my", "myself", "neither", "no", "nor", "not", "now", "of",
  "off", "on", "once", "one", "only", "or", "other", "others", "ought", "our", "ours", "ourselves", "out",
  "over", "own", "per", "same", "shall", "she", "should", "so", "some", "such", "than", "that", "the", "their",
  "theirs", "them", "themselves", "then", "there", "therefore", "these", "they", "this", "those", "though",
  "through", "thus", "to", "too", "under", "until", "up", "upon", "us", "very", "via", "was", "we", "well",
  "were", "what", "when", "where", "whether", "which", "while", "who", "whom", "whose", "why", "will", "with",
  "within", "without", "would", "yet", "you", "your", "yours", "yourself", "yourselves"
]);

// Titles are always followed by a name, so a period after them never ends a sentence.
const TITLE_ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "mx", "dr", "prof", "sr", "jr", "st", "rev", "hon", "capt", "sgt", "lt", "col", "gen",
  "messrs", "fr", "gov", "sen", "rep", "supt"
]);

// These are effectively never sentence-final in real prose.
const INLINE_ABBREVIATIONS = new Set(["e.g", "i.e", "vs", "viz", "cf", "al", "resp"]);

// These can end a sentence ("...oranges, etc. Then we left."), so a break after
// them is only suppressed when the next word is not capitalised.
const COMMON_ABBREVIATIONS = new Set([
  "etc", "inc", "ltd", "llc", "plc", "co", "corp", "dept", "dist", "div", "fig", "figs", "no", "nos", "vol",
  "vols", "ed", "eds", "pp", "p", "ch", "sec", "approx", "est", "ca", "circa", "jan", "feb", "mar", "apr",
  "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec", "mon", "tue", "tues", "wed", "thu", "thur", "thurs",
  "fri", "sat", "sun", "univ", "mt", "ft", "rd", "ave", "blvd", "tel", "ext", "min", "max"
]);

const CLOSERS = "\"'’”)]}";

/**
 * Splits text into sentences. Paragraph breaks are hard boundaries; inside a
 * paragraph a run of `.`/`!`/`?` only ends a sentence when whitespace (or the
 * end of the text) follows it, so "3.5" and "example.com" stay intact, and a
 * known abbreviation suppresses the break.
 */
export function splitSentences(text) {
  const paragraphs = String(text || "").replace(/\r\n?/g, "\n").split(/\n\s*\n+/);
  const sentences = [];
  for (const paragraph of paragraphs) {
    const flat = paragraph.replace(/\s+/g, " ").trim();
    if (!flat) continue;
    for (const sentence of splitParagraph(flat)) sentences.push(sentence);
  }
  return sentences;
}

function splitParagraph(paragraph) {
  const sentences = [];
  let start = 0;
  let index = 0;
  while (index < paragraph.length) {
    const char = paragraph[index];
    if (char !== "." && char !== "!" && char !== "?") {
      index += 1;
      continue;
    }
    let end = index;
    while (end + 1 < paragraph.length && ".!?".includes(paragraph[end + 1])) end += 1;
    let after = end + 1;
    while (after < paragraph.length && CLOSERS.includes(paragraph[after])) after += 1;

    const next = paragraph[after];
    if (next !== undefined && next !== " ") {
      index = after;
      continue;
    }
    if (char === "." && end === index && suppressesBreak(paragraph.slice(start, index), paragraph.slice(after + 1))) {
      index = after;
      continue;
    }
    const sentence = paragraph.slice(start, after).trim();
    if (sentence) sentences.push(sentence);
    start = after;
    index = after;
  }
  const tail = paragraph.slice(start).trim();
  if (tail) sentences.push(tail);
  return sentences;
}

function suppressesBreak(before, rest) {
  const match = /(\S+)$/.exec(before);
  if (!match) return false;
  const token = match[1].replace(/^[^\p{L}\p{N}]+/u, "");
  if (!token) return false;
  const lower = token.toLowerCase();
  if (TITLE_ABBREVIATIONS.has(lower) || INLINE_ABBREVIATIONS.has(lower)) return true;

  const nextStartsUpper = /^["'“(\[]*\p{Lu}/u.test(rest);
  const isInitialism = /^(?:\p{L}\.)+\p{L}$/u.test(token) || /^\p{L}$/u.test(token);
  if (isInitialism) {
    // An upper-case initialism ("U.S. Army", "J. R. R. Tolkien") is part of a
    // name; a lower-case one ("3 p.m. It was late.") often ends the sentence.
    if (token === token.toUpperCase()) return true;
    return !nextStartsUpper;
  }
  if (COMMON_ABBREVIATIONS.has(lower)) return !nextStartsUpper;
  return false;
}

/** Lower-cased word tokens, Unicode aware so non-Latin PDFs still tokenise. */
export function tokenize(text) {
  return String(text || "").toLowerCase().match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu) || [];
}

/** Conservative plural/suffix folding so "invoices" and "invoice" match. */
export function normalizeTerm(term) {
  const word = String(term || "").toLowerCase();
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && /(sses|shes|ches|xes|zes)$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !/(ss|us|is|as|os)$/.test(word)) return word.slice(0, -1);
  return word;
}

/** Stopword-free, suffix-folded terms. Digits are kept: questions cite numbers. */
export function contentTerms(text) {
  const terms = [];
  for (const token of tokenize(text)) {
    if (token.length < 2 || STOPWORDS.has(token)) continue;
    const term = normalizeTerm(token);
    if (STOPWORDS.has(term)) continue;
    terms.push(term);
  }
  return terms;
}

/**
 * Ranks a document's terms by frequency weighted by how widely they are spread
 * across its sentences: `tf * (1 + ln(sentences containing the term))`. In a
 * single document a term that recurs across many sentences is the topic, so
 * cross-document IDF would work backwards here.
 */
export function extractKeywords(text, { limit = 10 } = {}) {
  const sentences = splitSentences(text);
  const frequency = new Map();
  const spread = new Map();
  const surface = new Map();
  for (const sentence of sentences) {
    const seen = new Set();
    for (const token of tokenize(sentence)) {
      if (token.length < 3 || STOPWORDS.has(token) || /^\d+$/.test(token)) continue;
      const term = normalizeTerm(token);
      if (STOPWORDS.has(term)) continue;
      frequency.set(term, (frequency.get(term) || 0) + 1);
      if (!surface.has(term)) surface.set(term, token);
      if (!seen.has(term)) {
        seen.add(term);
        spread.set(term, (spread.get(term) || 0) + 1);
      }
    }
  }
  return [...frequency.entries()]
    .map(([term, count]) => ({
      term: surface.get(term) || term,
      count,
      sentences: spread.get(term) || 1,
      score: round(count * (1 + Math.log(spread.get(term) || 1))),
    }))
    .sort((left, right) => right.score - left.score || right.count - left.count || left.term.localeCompare(right.term))
    .slice(0, Math.max(1, Math.trunc(Number(limit) || 10)));
}

// TextRank builds a dense similarity graph, so cap the candidate set. Longer
// documents are pre-filtered by centroid weight first, which keeps a 500-page
// PDF responsive without changing the algorithm for normal documents.
const MAX_GRAPH_SENTENCES = 400;

/**
 * Extractive summary via TextRank over a TF-IDF cosine similarity graph.
 *
 * 1. Split into sentences, drop the ones too short to carry a claim.
 * 2. Weight each sentence's terms by `tf * ln(1 + N / df)` across sentences.
 * 3. Score sentences with damped PageRank over their cosine similarity graph.
 * 4. Apply positional weighting (openings and closings carry the thesis).
 * 5. Select greedily by score, skipping any sentence whose cosine similarity to
 *    an already-selected sentence exceeds `redundancy`.
 * 6. Re-order the winners by original position so the summary reads in order.
 *
 * Pass either `sentences` (a count) or `percent` (share of the document).
 */
export function summarizeText(text, options = {}) {
  const { sentences: requestedCount, percent, minSentenceWords = 4, redundancy = 0.55, keywordLimit = 10 } = options;
  const all = splitSentences(text);
  if (!all.length) throw new Error("There is no text to summarise.");

  const described = all.map((sentence, index) => ({
    index,
    text: sentence,
    terms: contentTerms(sentence),
    words: tokenize(sentence).length,
  }));
  const strong = described.filter((item) => item.terms.length >= 2 && item.words >= minSentenceWords);
  const usable = strong.length ? strong : described.filter((item) => item.terms.length > 0);
  if (!usable.length) throw new Error("This text has no sentences long enough to summarise.");

  const target = targetSentenceCount(usable.length, requestedCount, percent);
  const candidates = shortlist(usable, MAX_GRAPH_SENTENCES);
  const vectors = tfidfVectors(candidates);
  const ranked = textRank(vectors).map((rank, position) => ({
    ...candidates[position],
    position,
    score: rank * positionalWeight(candidates[position].index, all.length),
  }));

  const order = [...ranked].sort((left, right) => right.score - left.score || left.index - right.index);
  const chosen = [];
  for (const candidate of order) {
    if (chosen.length >= target) break;
    const duplicate = chosen.some((picked) => cosine(vectors[picked.position], vectors[candidate.position]) > redundancy);
    if (duplicate) continue;
    chosen.push(candidate);
  }
  chosen.sort((left, right) => left.index - right.index);

  const picked = chosen.map((item) => ({ index: item.index, text: item.text, score: round(item.score) }));
  return {
    summary: picked.map((item) => item.text).join(" "),
    sentences: picked,
    keywords: extractKeywords(text, { limit: keywordLimit }),
    stats: {
      sentenceCount: all.length,
      candidateCount: usable.length,
      graphSentences: candidates.length,
      wordCount: tokenize(text).length,
      requested: target,
      returned: picked.length,
    },
  };
}

function targetSentenceCount(total, requestedCount, percent) {
  const share = Number(percent);
  if (Number.isFinite(share) && share > 0) {
    return Math.max(1, Math.min(total, Math.round((total * share) / 100) || 1));
  }
  const count = Number(requestedCount ?? 5);
  if (!Number.isFinite(count) || count < 1) return Math.min(total, 5);
  return Math.max(1, Math.min(total, Math.trunc(count)));
}

/** Keeps the highest centroid-weight sentences when a document is very long. */
function shortlist(items, cap) {
  if (items.length <= cap) return items;
  const document = new Map();
  for (const item of items) for (const term of item.terms) document.set(term, (document.get(term) || 0) + 1);
  return [...items]
    .map((item) => ({
      item,
      weight: item.terms.reduce((total, term) => total + (document.get(term) || 0), 0) / Math.max(1, item.terms.length),
    }))
    .sort((left, right) => right.weight - left.weight)
    .slice(0, cap)
    .map((entry) => entry.item)
    .sort((left, right) => left.index - right.index);
}

function tfidfVectors(candidates) {
  const documentFrequency = new Map();
  for (const candidate of candidates) {
    for (const term of new Set(candidate.terms)) {
      documentFrequency.set(term, (documentFrequency.get(term) || 0) + 1);
    }
  }
  const total = candidates.length;
  return candidates.map((candidate) => {
    const weights = new Map();
    for (const term of candidate.terms) weights.set(term, (weights.get(term) || 0) + 1);
    let sumOfSquares = 0;
    for (const [term, count] of weights) {
      const weight = count * Math.log(1 + total / (documentFrequency.get(term) || 1));
      weights.set(term, weight);
      sumOfSquares += weight * weight;
    }
    return { weights, norm: Math.sqrt(sumOfSquares) };
  });
}

export function cosine(left, right) {
  if (!left || !right || !left.norm || !right.norm) return 0;
  const [small, large] = left.weights.size <= right.weights.size ? [left, right] : [right, left];
  let dot = 0;
  for (const [term, weight] of small.weights) {
    const other = large.weights.get(term);
    if (other) dot += weight * other;
  }
  return dot / (left.norm * right.norm);
}

function textRank(vectors, { damping = 0.85, iterations = 40, tolerance = 1e-6 } = {}) {
  const total = vectors.length;
  if (total === 0) return [];
  if (total === 1) return [1];

  const edges = Array.from({ length: total }, () => new Map());
  const weightSums = new Array(total).fill(0);
  for (let i = 0; i < total; i += 1) {
    for (let j = i + 1; j < total; j += 1) {
      const weight = cosine(vectors[i], vectors[j]);
      if (weight <= 0) continue;
      edges[i].set(j, weight);
      edges[j].set(i, weight);
      weightSums[i] += weight;
      weightSums[j] += weight;
    }
  }

  let rank = new Array(total).fill(1 / total);
  for (let step = 0; step < iterations; step += 1) {
    const next = new Array(total).fill((1 - damping) / total);
    for (let source = 0; source < total; source += 1) {
      const outgoing = weightSums[source];
      if (!outgoing) continue;
      for (const [targetIndex, weight] of edges[source]) {
        next[targetIndex] += (damping * weight * rank[source]) / outgoing;
      }
    }
    let delta = 0;
    for (let i = 0; i < total; i += 1) delta += Math.abs(next[i] - rank[i]);
    rank = next;
    if (delta < tolerance) break;
  }
  return rank;
}

/** Openings carry the thesis and closings the conclusion, so both get a lift. */
function positionalWeight(position, total) {
  if (total <= 1) return 1;
  const relative = Math.min(1, Math.max(0, position / (total - 1)));
  return 1 + 0.35 * Math.exp(-3 * relative) + 0.1 * Math.exp(-6 * (1 - relative));
}

/**
 * Splits per-page text into retrieval passages of roughly `targetWords`,
 * carrying `overlapSentences` of context across the boundary. Page numbers are
 * attached to every passage and never crossed: a passage always belongs to one
 * page, so citations stay accurate.
 *
 * `pages` is `[{ page, text }]` (a bare string array is also accepted, and its
 * positions become 1-based page numbers).
 */
export function chunkPages(pages, { targetWords = 110, overlapSentences = 1 } = {}) {
  const chunks = [];
  const list = Array.isArray(pages) ? pages : [];
  list.forEach((entry, position) => {
    const page = Number(entry && typeof entry === "object" ? entry.page ?? position + 1 : position + 1);
    const text = String(entry && typeof entry === "object" ? entry.text ?? "" : entry ?? "");
    const sentences = splitSentences(text);
    if (!sentences.length) return;

    let buffer = [];
    let words = 0;
    const push = () => {
      chunks.push({ id: chunks.length, page, text: buffer.join(" "), words });
    };
    for (const sentence of sentences) {
      const count = tokenize(sentence).length;
      if (words + count > targetWords && buffer.length) {
        push();
        buffer = overlapSentences > 0 ? buffer.slice(-overlapSentences) : [];
        words = buffer.reduce((total, item) => total + tokenize(item).length, 0);
      }
      buffer.push(sentence);
      words += count;
    }
    if (buffer.length) push();
  });
  return chunks;
}

/** Builds the BM25 statistics for a set of passages from `chunkPages`. */
export function buildPassageIndex(chunks) {
  const docs = (Array.isArray(chunks) ? chunks : []).map((chunk) => {
    const counts = new Map();
    const terms = contentTerms(chunk.text);
    for (const term of terms) counts.set(term, (counts.get(term) || 0) + 1);
    return { chunk, counts, length: terms.length };
  });
  const documentFrequency = new Map();
  for (const doc of docs) {
    for (const term of doc.counts.keys()) documentFrequency.set(term, (documentFrequency.get(term) || 0) + 1);
  }
  const totalLength = docs.reduce((total, doc) => total + doc.length, 0);
  const pages = new Set(docs.map((doc) => doc.chunk.page));
  return {
    docs,
    documentFrequency,
    count: docs.length,
    averageLength: docs.length ? totalLength / docs.length : 0,
    pageCount: pages.size,
  };
}

/**
 * Okapi BM25 ranking. Returns the best passages with their page number and the
 * query terms they actually matched, so the UI can cite and highlight.
 */
export function searchPassages(index, question, { limit = 3, k1 = 1.5, b = 0.75 } = {}) {
  if (!index || !index.count) throw new Error("Load a PDF before asking a question.");
  const query = [...new Set(contentTerms(question))];
  if (!query.length) throw new Error("Ask a question that contains at least one searchable word.");

  const results = [];
  for (const doc of index.docs) {
    let score = 0;
    const matchedTerms = [];
    for (const term of query) {
      const frequency = doc.counts.get(term) || 0;
      if (!frequency) continue;
      const df = index.documentFrequency.get(term) || 0;
      const idf = Math.log(1 + (index.count - df + 0.5) / (df + 0.5));
      const normalised = 1 - b + (b * doc.length) / (index.averageLength || 1);
      score += idf * ((frequency * (k1 + 1)) / (frequency + k1 * normalised));
      matchedTerms.push(term);
    }
    if (score > 0) results.push({ chunk: doc.chunk, page: doc.chunk.page, score: round(score), matchedTerms });
  }
  results.sort((left, right) => right.score - left.score || left.chunk.id - right.chunk.id);
  return results.slice(0, Math.max(1, Math.trunc(Number(limit) || 3)));
}

/**
 * Splits text into `{ text, match }` segments for the matched terms. The caller
 * renders these as React nodes, so highlighting never needs raw HTML.
 */
export function highlightSegments(text, terms) {
  const wanted = new Set((Array.isArray(terms) ? terms : []).map((term) => normalizeTerm(String(term))));
  const value = String(text || "");
  const segments = [];
  if (!wanted.size) return value ? [{ text: value, match: false }] : [];

  const pattern = /[\p{L}\p{N}]+/gu;
  let last = 0;
  let match = pattern.exec(value);
  while (match) {
    if (wanted.has(normalizeTerm(match[0]))) {
      if (match.index > last) segments.push({ text: value.slice(last, match.index), match: false });
      segments.push({ text: match[0], match: true });
      last = match.index + match[0].length;
    }
    match = pattern.exec(value);
  }
  if (last < value.length) segments.push({ text: value.slice(last), match: false });
  return segments;
}

function round(value) {
  return Number.isFinite(value) ? Number(value.toFixed(6)) : 0;
}

export const STOPWORD_LIST = [...STOPWORDS];
