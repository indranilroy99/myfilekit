import { tools } from "../registry/tools.registry.js";

// Words that carry no search intent. A natural query like "unlock my PDF" or
// "check this PDF for malware" is mostly these — matching on them returned zero
// results, so they are stripped before matching.
export const SEARCH_STOPWORDS = new Set([
  "my", "this", "the", "a", "an", "for", "to", "and", "of", "in", "on",
  "with", "how", "do", "i", "can", "is", "it",
]);

// Maps a content token to phrases that appear in the target tool's name/keywords,
// so security intent resolves to the flagship tool even when the user's word
// isn't literally in the tool text.
export const SEARCH_SYNONYMS = {
  malware: ["pdf analyser", "analyser"],
  virus: ["pdf analyser", "analyser"],
  suspicious: ["pdf analyser", "analyser"],
  unlock: ["unlock", "remove password"],
  redact: ["auto-redact", "redact"],
  pii: ["auto-redact", "redact"],
  protect: ["encrypt"],
  password: ["encrypt"],
  // Security intent (strip active content / CDR) resolves to the Sanitize tool.
  javascript: ["sanitize"],
  strip: ["sanitize"],
  disarm: ["sanitize"],
  cdr: ["sanitize"],
  sanitize: ["sanitize"],
  // Accessibility intent resolves to the accessibility tools ("Accessibility
  // Check" and "Make Accessible (Auto-Tag)" — both names contain "accessib").
  screen: ["accessib"],
  reader: ["accessib"],
  tag: ["accessib"],
  a11y: ["accessib"],
  accessible: ["accessib"],
  wcag: ["accessib"],
  ua: ["accessib"],
  // Embedded-image intent resolves to Extract Images & Attachments.
  embedded: ["extract images"],
};

// Conversion queries are directional, but "jpg to pdf" and "pdf to jpg" reduce
// to the same two tokens once "to" is stripped as a stopword — so token scoring
// alone ranked the wrong converter first. These families let a query term and a
// tool's own wording be compared as formats rather than as literal strings, so
// "photos", "jpg" and "image" all mean the same thing on either side of "to".
export const FORMAT_FAMILIES = {
  image: ["image", "images", "img", "imgs", "photo", "photos", "picture", "pictures", "pic", "pics", "jpg", "jpeg", "png", "webp"],
  pdf: ["pdf", "pdfs"],
  word: ["word", "doc", "docx"],
  excel: ["excel", "xls", "xlsx", "spreadsheet", "sheet", "sheets"],
  powerpoint: ["powerpoint", "ppt", "pptx", "slides", "presentation"],
  text: ["text", "txt", "plaintext"],
  ebook: ["ebook", "epub", "book"],
};

const FORMAT_FAMILY_BY_TERM = new Map();
for (const [family, terms] of Object.entries(FORMAT_FAMILIES)) {
  for (const term of terms) FORMAT_FAMILY_BY_TERM.set(term, family);
}

/** The format family a single term belongs to, or the term itself when it is not a known format. */
export function formatFamily(term) {
  return FORMAT_FAMILY_BY_TERM.get(term) || term;
}

const DIRECTION_PATTERN = /([a-z0-9+.#]+)\s+(?:to|into|as)\s+([a-z0-9+.#]+)/g;

/** Every "A to B" conversion direction stated in a piece of text, as format families. */
export function conversionDirections(text) {
  const directions = [];
  for (const match of String(text).toLowerCase().matchAll(DIRECTION_PATTERN)) {
    directions.push({ from: formatFamily(match[1]), to: formatFamily(match[2]) });
  }
  return directions;
}

/** The single direction a user's query asks for, or null when the query isn't a conversion. */
export function queryDirection(query) {
  return conversionDirections(query)[0] || null;
}

// A tool states its directions in its name ("Images to PDF") and its keywords
// ("jpg to pdf", "photos to pdf"). Cached per tool object — the registry is a
// module-level constant, so this is computed once per tool per session.
const directionCache = new WeakMap();
export function toolDirections(tool) {
  const cached = directionCache.get(tool);
  if (cached) return cached;
  const directions = conversionDirections([tool.name, ...(tool.keywords || [])].join(" ; "));
  directionCache.set(tool, directions);
  return directions;
}

// A tool that converts the way the user asked wins outright; one that converts
// the opposite way is demoted below the generic matches rather than removed,
// because a mis-typed direction should still be recoverable from the results.
const DIRECTION_MATCH_BOOST = 150;
const DIRECTION_REVERSE_PENALTY = 60;

export function searchableText(tool) {
  return [tool.name, tool.category, tool.description, ...(tool.keywords || []), ...(tool.badges || []), ...(tool.acceptedTypes || [])].join(" ").toLowerCase();
}

export function filterTools(query) {
  const rawPhrase = query.toLowerCase().trim().replace(/\s+/g, " ");
  const parts = query.toLowerCase().trim().split(/\s+/).filter(Boolean).filter((part) => !SEARCH_STOPWORDS.has(part));
  if (!parts.length) return tools;
  const direction = queryDirection(rawPhrase);
  const scored = [];
  for (const tool of tools) {
    const name = tool.name.toLowerCase();
    const keywords = (tool.keywords || []).join(" ").toLowerCase();
    const description = tool.description.toLowerCase();
    const haystack = searchableText(tool);
    let score = 0;
    for (const part of parts) {
      // Direct match keeps the existing name > keyword > description ranking.
      if (name === part) score += 100;
      else if (name.startsWith(part)) score += 60;
      else if (name.includes(part)) score += 40;
      else if (keywords.includes(part)) score += 20;
      else if (description.includes(part)) score += 10;
      else if (haystack.includes(part)) score += 5;
      // Synonyms resolve security terms to the right flagship tool with a strong
      // boost. Matched against the name only — a haystack match is too loose
      // ("encrypt" would hit "encrypted"/"unprotect" in unrelated tools).
      for (const phrase of SEARCH_SYNONYMS[part] || []) {
        if (name.includes(phrase)) score += 50;
      }
    }
    // Phrase / exact-name boost: when the whole multi-word query matches a tool's
    // name exactly, or a keyword phrase contains it, that tool is the intended
    // one — it must beat generic single-token ties that otherwise fall back to
    // registry order (e.g. "extract images from pdf" vs "Extract Text from PDF").
    // The raw query is matched too, not only the stopword-stripped one: a tool
    // whose keyword is literally "jpg to pdf" should be credited for it, and
    // stripping "to" hid that phrase from this boost entirely.
    if (score > 0 && parts.length > 1) {
      const strippedPhrase = parts.join(" ");
      const phrases = rawPhrase === strippedPhrase ? [strippedPhrase] : [strippedPhrase, rawPhrase];
      let best = 0;
      for (const phrase of phrases) {
        if (name === phrase) best = Math.max(best, 200);
        else if (name.includes(phrase)) best = Math.max(best, 120);
        else {
          for (const keyword of tool.keywords || []) {
            const kw = keyword.toLowerCase();
            if (kw === phrase) { best = Math.max(best, 120); break; }
            if (kw.includes(phrase)) { best = Math.max(best, 80); break; }
          }
        }
      }
      score += best;
    }
    // Direction decides between the two halves of a conversion pair.
    if (score > 0 && direction && direction.from !== direction.to) {
      const directions = toolDirections(tool);
      if (directions.some((entry) => entry.from === direction.from && entry.to === direction.to)) score += DIRECTION_MATCH_BOOST;
      else if (directions.some((entry) => entry.from === direction.to && entry.to === direction.from)) score = Math.max(1, score - DIRECTION_REVERSE_PENALTY);
    }
    if (score > 0) scored.push({ tool, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.map((entry) => entry.tool);
}
