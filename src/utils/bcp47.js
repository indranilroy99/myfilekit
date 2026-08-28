// Shared BCP-47 language-tag validation — the single source of truth for the
// PDF services that write a caller-supplied language into a catalog /Lang.
//
// A BCP-47-ish tag: a 2–8 letter primary subtag plus optional alphanumeric
// subtags (script/region/variant). Deliberately strict — it rejects anything
// carrying PDF dictionary syntax such as ')', '<<', '/', or whitespace, so a
// free-text value like
//   'en) >> /OpenAction << /S /JavaScript /JS(…) >>'
// can never reach a catalog as literal syntax.
export const LANG_TAG = /^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$/;

// Validates a caller-supplied language tag. Accepts a value present in the
// optional `known` Set (verbatim) or one matching the BCP-47 shape; otherwise
// returns the fallback. Never throws.
export function safeLangTag(raw, fallback = "en", known = null) {
  const value = String(raw ?? "").trim();
  if ((known && known.has(value)) || LANG_TAG.test(value)) return value;
  return fallback;
}
