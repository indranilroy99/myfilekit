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
};

export function searchableText(tool) {
  return [tool.name, tool.category, tool.description, ...(tool.keywords || []), ...(tool.badges || []), ...(tool.acceptedTypes || [])].join(" ").toLowerCase();
}

export function filterTools(query) {
  const parts = query.toLowerCase().trim().split(/\s+/).filter(Boolean).filter((part) => !SEARCH_STOPWORDS.has(part));
  if (!parts.length) return tools;
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
    if (score > 0) scored.push({ tool, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.map((entry) => entry.tool);
}
