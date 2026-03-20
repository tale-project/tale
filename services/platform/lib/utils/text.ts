const LEADING_PUNCTUATION_RE = /^[\s:：;；,，.。!！?？…·\-—–]+/;

export function stripLeadingPunctuation(text: string) {
  return text.replace(LEADING_PUNCTUATION_RE, '');
}
