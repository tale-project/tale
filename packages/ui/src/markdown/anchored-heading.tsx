import { Check, Link as LinkIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Children, cloneElement, isValidElement, useState } from 'react';

interface ChildrenContainer {
  children?: ReactNode;
}

/** Concatenate the visible text inside a React node tree. */
export function nodeText(node: ReactNode): string {
  let out = '';
  Children.forEach(node, (child) => {
    if (typeof child === 'string' || typeof child === 'number') {
      out += String(child);
    } else if (isValidElement<ChildrenContainer>(child)) {
      out += nodeText(child.props.children);
    }
  });
  return out;
}

/**
 * Pandoc-style explicit-id syntax at the end of a heading. Matches the
 * trailing token `{#some-id}` (optionally with surrounding whitespace) so
 * authors can override the auto-generated slug — handy for stable anchor
 * URLs across renames or non-Latin headings.
 */
const EXPLICIT_ID_PATTERN = /\s*\{#([a-zA-Z0-9_-]+)\}\s*$/;

export interface ExplicitIdResult {
  id: string | null;
  /** Children with the trailing `{#id}` token removed. */
  children: ReactNode;
}

/**
 * Walk a heading's children and pull out a trailing `{#custom-id}` token if
 * one is present. Returns the id and a new children array with the token
 * stripped from its terminal text node.
 */
export function extractExplicitId(children: ReactNode): ExplicitIdResult {
  const arr = Children.toArray(children);
  for (let i = arr.length - 1; i >= 0; i--) {
    const node = arr[i];
    if (typeof node === 'string') {
      const match = EXPLICIT_ID_PATTERN.exec(node);
      if (match) {
        const trimmed = node.slice(0, match.index).replace(/\s+$/, '');
        const next =
          trimmed.length > 0
            ? [...arr.slice(0, i), trimmed, ...arr.slice(i + 1)]
            : [...arr.slice(0, i), ...arr.slice(i + 1)];
        return { id: match[1], children: next };
      }
      // Non-empty, non-whitespace text without the marker: stop searching —
      // the marker must be the trailing token.
      if (node.trim().length > 0) return { id: null, children };
      continue;
    }
    if (isValidElement<ChildrenContainer>(node)) {
      const inner = extractExplicitId(node.props.children);
      if (inner.id) {
        const replaced = cloneElement(node, undefined, inner.children);
        const next = [...arr.slice(0, i), replaced, ...arr.slice(i + 1)];
        return { id: inner.id, children: next };
      }
      return { id: null, children };
    }
  }
  return { id: null, children };
}

/** GitHub-style heading slug: lower-case, alphanumerics + hyphens. */
export function slugifyHeading(input: ReactNode | string): string {
  const text = typeof input === 'string' ? input : nodeText(input);
  const slug = text
    .toLowerCase()
    // German transliteration before NFKD strips diacritics, so "Größe"
    // becomes "groesse" instead of colliding with "große" -> "groe".
    .replace(/ß/g, 'ss')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .normalize('NFKD')
    // Strip combining diacritical marks (U+0300..U+036F).
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
  // Fallback for headings whose characters are entirely stripped (e.g.
  // CJK-only). Without this, multiple such headings would all collide
  // on the empty string and break in-page anchors.
  return slug || 'section';
}

interface AnchoredHeadingProps {
  level: 'h1' | 'h2' | 'h3' | 'h4';
  className: string;
  children?: ReactNode;
}

export function AnchoredHeading({
  level,
  className,
  children,
}: AnchoredHeadingProps) {
  const explicit = extractExplicitId(children);
  const renderedChildren = explicit.children;
  const id = explicit.id ?? slugifyHeading(renderedChildren);
  const Tag = level;
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    // Guard for SSR / non-browser environments where `navigator` is absent.
    if (typeof window === 'undefined' || !navigator.clipboard) return;
    const url = `${window.location.origin}${window.location.pathname}#${id}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (error) {
      console.warn('[anchored-heading] clipboard write failed', error);
    }
  };

  return (
    <Tag id={id} className={`group scroll-mt-24 ${className}`}>
      <a href={`#${id}`} className="text-fg-base no-underline">
        {renderedChildren}
      </a>
      <button
        type="button"
        onClick={handleCopy}
        aria-label={copied ? 'Link copied' : 'Copy link to this section'}
        aria-live="polite"
        // Hidden until hover/focus so the chrome stays calm on touch devices.
        // `print:hidden` keeps printed pages free of the affordance.
        className={`text-fg-muted hover:text-fg-base ml-2 inline-flex size-6 items-center justify-center rounded-md align-middle opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-current/20 print:hidden ${
          copied ? 'text-emerald-600 opacity-100 dark:text-emerald-400' : ''
        }`}
      >
        {copied ? (
          <Check className="size-4" aria-hidden />
        ) : (
          <LinkIcon className="size-4" aria-hidden />
        )}
      </button>
    </Tag>
  );
}
