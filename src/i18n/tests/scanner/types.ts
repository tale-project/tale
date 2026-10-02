/**
 * Scanner public types.
 *
 * The scanner reads a `Source` (a JSON locale file or a markdown page) and
 * emits `Fragment`s — text snippets with position metadata, locale, and
 * source surface. Every fragment is mask-applied: code fences, inline-code
 * spans, link URLs, frontmatter, ICU placeholders, and template literals
 * are replaced with same-length spaces so a check's regex match indices
 * remain valid columns in the original source.
 */

export interface FragmentPosition {
  /** Repo-relative file path. */
  readonly file: string;
  /** 1-based line in the original (unmasked) source. */
  readonly line: number;
  /** 1-based column where the fragment text starts. */
  readonly column: number;
}

export interface Fragment {
  readonly pos: FragmentPosition;
  /** Mask-applied text. Same length as the original; column-stable. */
  readonly text: string;
  /** Dotted JSON key path for JSON fragments; null for markdown. */
  readonly key: string | null;
  readonly surface: 'json' | 'markdown';
  readonly locale: string;
  /**
   * Frontmatter-declared per-page opt-outs. Markdown only.
   * Keys are CheckId-strings; values are `true` when the check is disabled
   * for this fragment's source file.
   */
  readonly disabled?: ReadonlySet<string>;
}

export interface JsonSource {
  readonly kind: 'json';
  readonly path: string;
  readonly locale: string;
}

export interface MarkdownSource {
  readonly kind: 'markdown';
  readonly path: string;
  readonly locale: string;
}

export type Source = JsonSource | MarkdownSource;

/** Optional fragment filter passed to `Scanner.fragments`. */
export interface FragmentFilter {
  readonly surface?: 'json' | 'markdown';
  readonly locale?: string;
}
