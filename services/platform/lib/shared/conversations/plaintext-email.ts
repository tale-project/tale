import he from 'he';

/** Serialize a plain message for the HTML send contract without interpreting markup. */
export function plaintextToEmailHtml(text: string): string {
  return `<p>${he.escape(text).replace(/\r\n|\r|\n/g, '<br>')}</p>`;
}
