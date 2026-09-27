/**
 * An email message as the corpus indexes it: its readable text, and the names
 * a search hit shows and the chunk header carries.
 *
 * Layer A: pure string work, no `node:*`, no DOM.
 */

import { isRecord } from '../utils/type-utils';
import { htmlToText } from './html-to-text';
import { stripControlCharacters } from './sanitize-text';

/**
 * The readable text of a message body — what gets chunked and embedded.
 *
 * The mail lane stores `content` as `email.html || email.text` and keeps both
 * parts on the metadata, so a body is HTML exactly when the metadata's `html`
 * IS the content. That body reads through `htmlToText`, the same stripper the
 * conversation search's body match uses: scripts, styles and markup out,
 * block structure and absolute links kept. Everything else is plain text and
 * stays as written — a plain-text reply quoting `Bob <bob@example.com>` holds
 * an address, not a tag, and the tag strip would eat it.
 *
 * `''` when nothing readable is left: an empty body, or markup and images
 * alone.
 */
export function messageBodyText(content: string, metadata: unknown): string {
  const html =
    isRecord(metadata) && typeof metadata.html === 'string'
      ? metadata.html
      : null;
  const isHtml = html !== null && html.trim() !== '' && html === content;
  return (isHtml ? htmlToText(content) : content).trim();
}

/** The longest subject or correspondent a name carries; the chunk header has
 * its own ceiling, this one keeps the stored filename bounded too. */
const NAME_PART_MAX = 200;

function namePart(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const clean = stripControlCharacters(value).replace(/\s+/g, ' ').trim();
  if (clean === '') return null;
  return clean.length > NAME_PART_MAX
    ? `${clean.slice(0, NAME_PART_MAX - 1)}…`
    : clean;
}

/**
 * How a message names itself in the corpus.
 *
 * `filename` is the corpus row's name — what a search hit shows as its title:
 * the subject, or who wrote when there is none. `title` is what the header of
 * every chunk announces, and it feeds BOTH search legs: the subject and the
 * correspondent joined as prose, the way an emailed attachment's header
 * carries its mail (#3014), so a question naming the sender or the topic
 * reaches a passage that names neither.
 *
 * Both are text an outsider chose — the reader wraps a message hit as
 * untrusted wholesale — so this only strips control characters (a NUL cannot
 * be stored) and bounds the length.
 */
export function messageCorpusNames(args: {
  /** The mail's subject, never the stored no-subject placeholder. */
  readonly subject?: string | null;
  /** Who wrote it, as a person reads it (`Bob Example <bob@example.com>`). */
  readonly correspondent?: string | null;
}): { filename: string; title: string } {
  const subject = namePart(args.subject);
  const correspondent = namePart(args.correspondent);
  const byline =
    correspondent === null
      ? null
      : subject === null
        ? `Email from ${correspondent}`
        : `from ${correspondent}`;
  const filename =
    subject ??
    (correspondent !== null ? `Email from ${correspondent}` : 'Email');
  const title =
    [subject, byline].filter((part) => part !== null).join(' — ') || filename;
  return { filename, title };
}

/**
 * The person a message is from, read off the envelope the mail lane stores
 * (`metadata.from`: `{ name?, address }[]`) — `Name <address>`, the address
 * alone, or the name alone. Null when the envelope names nobody, so the caller
 * can fall back to the conversation's contact.
 */
export function messageCorrespondent(metadata: unknown): string | null {
  if (!isRecord(metadata) || !Array.isArray(metadata.from)) return null;
  const first: unknown = metadata.from[0];
  if (!isRecord(first)) return null;
  const name = typeof first.name === 'string' ? first.name.trim() : '';
  const address = typeof first.address === 'string' ? first.address.trim() : '';
  if (name !== '' && address !== '' && name !== address) {
    return `${name} <${address}>`;
  }
  return address !== '' ? address : name !== '' ? name : null;
}
