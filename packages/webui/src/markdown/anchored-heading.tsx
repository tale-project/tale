import { Check, Link as LinkIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Children, isValidElement, useState } from 'react';

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
  const id = slugifyHeading(children);
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
        {children}
      </a>
      <button
        type="button"
        onClick={handleCopy}
        aria-label={copied ? 'Link copied' : 'Copy link to this section'}
        aria-live="polite"
        // Hidden until hover/focus so the chrome stays calm on touch devices,
        // matching the Mintlify pattern. `print:hidden` keeps printed pages
        // free of the affordance.
        className={`text-fg-muted hover:text-fg-base ml-2 inline-flex size-6 items-center justify-center rounded-md align-middle opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-current/20 print:hidden ${
          copied ? 'text-emerald-600 opacity-100' : ''
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
