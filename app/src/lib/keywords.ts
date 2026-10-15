// Keyword search: what Jack types into a search box, read as keywords
// rather than one exact string. "renewal partner" finds a note with both
// words anywhere in it, not only side by side.
//   word          must appear
//   "two words"   that exact phrase must appear
//   -word         must NOT appear (also -"a phrase")
//   a OR b        either one (OR in capitals, between two terms)
export interface KeywordQuery { groups: string[][]; none: string[]; empty: boolean }

export function parseKeywords(input: string): KeywordQuery {
  const tokens: { text: string; neg: boolean; or: boolean }[] = [];
  const re = /(-?)"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input))) {
    if (m[3] === "OR") { if (tokens.length) tokens[tokens.length - 1].or = true; continue; }
    const neg = m[1] === "-" || (!!m[3] && m[3].startsWith("-") && m[3].length > 1);
    const text = (m[2] ?? (m[3]!.startsWith("-") && m[3]!.length > 1 ? m[3]!.slice(1) : m[3]!)).trim().toLowerCase();
    if (text) tokens.push({ text, neg, or: false });
  }
  const groups: string[][] = [];
  const none: string[] = [];
  let joinNext = false;
  for (const t of tokens) {
    if (t.neg) { none.push(t.text); joinNext = false; continue; }
    if (joinNext && groups.length) groups[groups.length - 1].push(t.text);
    else groups.push([t.text]);
    joinNext = t.or;
  }
  return { groups, none, empty: !groups.length && !none.length };
}

/** Every group has at least one of its terms, and no excluded term appears. */
export function matchesKeywords(haystack: string, k: KeywordQuery): boolean {
  if (k.empty) return true;
  for (const n of k.none) if (haystack.includes(n)) return false;
  return k.groups.every((g) => g.some((t) => haystack.includes(t)));
}
