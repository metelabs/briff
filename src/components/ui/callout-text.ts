/**
 * Splits a status message into its first sentence (set bold) and the rest. A sentence ends at
 * `.`, `!` or `?` followed by whitespace, so the dots inside an email address or a version stay
 * in place ("We sent a link to a.b@example.com. Your email changes ...").
 */
export function splitFirstSentence(message: string): { lead: string; rest: string } {
  const text = message.trim();
  const end = /[.!?](?=\s)/.exec(text);
  if (!end) return { lead: text, rest: "" };
  const cut = end.index + 1;
  return { lead: text.slice(0, cut), rest: text.slice(cut).trim() };
}
