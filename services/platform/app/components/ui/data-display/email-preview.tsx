'use client';

import DOMPurify from 'dompurify';
import { CSSProperties, useMemo, useState } from 'react';

import { cn } from '@/lib/utils/cn';

export interface EmailPreviewProps {
  html: string;
  className?: string;
  style?: CSSProperties;
  cidMap?: Record<string, string>;
}

const ALLOWED_TAGS = [
  'div',
  'p',
  'br',
  'strong',
  'em',
  'b',
  'i',
  'u',
  'a',
  'ul',
  'ol',
  'li',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'img',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'td',
  'th',
  'span',
  'center',
  'blockquote',
  'pre',
  'code',
  'hr',
];

const ALLOWED_ATTR = [
  'style',
  'href',
  'target',
  'rel',
  'class',
  'src',
  'alt',
  'width',
  'height',
  'max-width',
  'max-height',
  'text-align',
  'cellspacing',
  'cellpadding',
  'border',
  'bgcolor',
  'align',
  'valign',
  'colspan',
  'rowspan',
  'role',
  'margin',
  'margin-block-start',
  'margin-block-end',
  'margin-inline-start',
  'margin-inline-end',
  'margin-top',
  'margin-bottom',
  'margin-left',
  'margin-right',
  'padding',
  'padding-top',
  'padding-bottom',
  'padding-left',
  'padding-right',
  'padding-block-start',
  'padding-block-end',
  'padding-inline-start',
  'padding-inline-end',
];

// Allowlist of safe CSS properties for email rendering
// Excludes: position, background-image/url (tracking), expression, behavior, -moz-binding
const ALLOWED_CSS_PROPERTIES = new Set([
  // Typography
  'color',
  'font',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'font-variant',
  'letter-spacing',
  'line-height',
  'text-align',
  'text-decoration',
  'text-indent',
  'text-transform',
  'white-space',
  'word-spacing',
  'word-wrap',
  'word-break',
  'overflow-wrap',
  // Box model
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'margin-block-start',
  'margin-block-end',
  'margin-inline-start',
  'margin-inline-end',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'padding-block-start',
  'padding-block-end',
  'padding-inline-start',
  'padding-inline-end',
  'border',
  'border-top',
  'border-right',
  'border-bottom',
  'border-left',
  'border-width',
  'border-style',
  'border-color',
  'border-radius',
  'border-collapse',
  'border-spacing',
  // Sizing
  'width',
  'height',
  'min-width',
  'min-height',
  'max-width',
  'max-height',
  // Display & layout (no position/z-index to prevent overlay attacks)
  'display',
  'visibility',
  'opacity',
  'vertical-align',
  'float',
  'clear',
  'overflow',
  'overflow-x',
  'overflow-y',
  // Background (color only, no images/urls)
  'background-color',
  // Table
  'table-layout',
  'empty-cells',
  'caption-side',
  // List
  'list-style',
  'list-style-type',
  // Flexbox (safe subset)
  'flex',
  'flex-direction',
  'flex-wrap',
  'justify-content',
  'align-items',
  'align-content',
  'gap',
  'row-gap',
  'column-gap',
]);

/**
 * Sanitize a CSS style string by only allowing safe properties.
 * Blocks: url(), expression(), behavior, position, z-index, and other dangerous values.
 */
function sanitizeCssStyle(styleString: string): string {
  const sanitizedParts: string[] = [];

  // Parse style string into property-value pairs
  const declarations = styleString.split(';');

  for (const declaration of declarations) {
    const colonIndex = declaration.indexOf(':');
    if (colonIndex === -1) continue;

    const property = declaration.slice(0, colonIndex).trim().toLowerCase();
    const value = declaration.slice(colonIndex + 1).trim();

    // Skip if property not in allowlist
    if (!ALLOWED_CSS_PROPERTIES.has(property)) continue;

    // Block dangerous values: url(), expression(), javascript:, data:, behavior, -moz-binding
    const lowerValue = value.toLowerCase();
    if (
      lowerValue.includes('url(') ||
      lowerValue.includes('expression(') ||
      lowerValue.includes('javascript:') ||
      lowerValue.includes('data:') ||
      lowerValue.includes('behavior:') ||
      lowerValue.includes('-moz-binding')
    ) {
      continue;
    }

    sanitizedParts.push(`${property}: ${value}`);
  }

  return sanitizedParts.join('; ');
}

export function replaceCidReferences(
  html: string,
  cidMap: Record<string, string>,
): string {
  if (Object.keys(cidMap).length === 0) return html;
  return html.replace(/src=["']cid:([^"']+)["']/gi, (_match, cid: string) => {
    const url = cidMap[cid];
    return url ? `src="${url}"` : _match;
  });
}

function sanitizePreviewHtml(html: string): string {
  // First, remove plain text quote markers (> at start of lines)
  const processed = html
    // Remove &gt; entities at the start of lines (with optional spaces)
    .replace(/^(&gt;\s*)+/gm, '')
    // Remove > characters at the start of lines (with optional spaces)
    .replace(/^(>\s*)+/gm, '')
    // Remove quote markers after line breaks
    .replace(/(<br\s*\/?>\s*)(&gt;\s*)+/gi, '$1')
    .replace(/(<br\s*\/?>\s*)(>\s*)+/gi, '$1');

  // Add hook to sanitize styles and modify links
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (!(node instanceof Element)) return;

    // Sanitize inline styles through our CSS allowlist
    if (node.hasAttribute('style')) {
      const rawStyle = node.getAttribute('style');
      if (rawStyle) {
        const sanitizedStyle = sanitizeCssStyle(rawStyle);
        if (sanitizedStyle) {
          node.setAttribute('style', sanitizedStyle);
        } else {
          node.removeAttribute('style');
        }
      }
    }

    if (node.tagName === 'A') {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
  });

  const sanitized = DOMPurify.sanitize(processed, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
  });

  DOMPurify.removeHook('afterSanitizeAttributes');

  return sanitized;
}

function splitQuotedContent(html: string): { main: string; quoted: string } {
  // Common patterns for forwarded/quoted content
  const patterns = [
    /(?:Begin forwarded message|On .* wrote|From:.*Subject:|-----Original Message-----)/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match && match.index !== undefined) {
      return {
        main: html.slice(0, match.index).trim(),
        quoted: html.slice(match.index).trim(),
      };
    }
  }

  return { main: html, quoted: '' };
}

export function EmailPreview({
  html,
  className,
  style,
  cidMap,
}: EmailPreviewProps) {
  const [showQuoted, setShowQuoted] = useState(false);

  const { sanitizedMain, sanitizedQuoted } = useMemo(() => {
    const { main, quoted } = splitQuotedContent(html);
    const resolvedMain = cidMap ? replaceCidReferences(main, cidMap) : main;
    const resolvedQuoted = cidMap
      ? replaceCidReferences(quoted, cidMap)
      : quoted;
    return {
      sanitizedMain: sanitizePreviewHtml(resolvedMain),
      sanitizedQuoted: resolvedQuoted
        ? sanitizePreviewHtml(resolvedQuoted)
        : '',
    };
  }, [html, cidMap]);

  const hasQuotedContent = sanitizedQuoted.length > 0;

  // Behaves like a normal div container element; height follows content unless constrained by parent styles
  return (
    <div className={cn('min-w-0', className)} style={style}>
      {/* Scoped styles to restore UA defaults to descendants and keep images responsive, while inheriting bubble text styles */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
          /* Reset and base styles */
            [data-preview-sandbox] {
              font-size: 13px;
              line-height: 1.5;
              word-wrap: break-word;
              overflow-wrap: break-word;
              background-color: white;
              color: black;
              padding: 1rem;
              overflow-x: auto;
              max-width: 100%;
            }

            .dark [data-preview-sandbox] {
              background-color: hsl(var(--card));
              color: hsl(var(--card-foreground));
            }

            /* Responsive images - use inline-block so they respect parent text-align */
            [data-preview-sandbox] img {
              max-width: 100%;
              height: auto;
              display: inline-block;
            }

            /* Table styles for email layouts */
            [data-preview-sandbox] table {
              border-spacing: 0;
              /* Use separate borders to allow padding on table elements */
              border-collapse: separate;
            }

            /* Make table cells wrap and break content */
            [data-preview-sandbox] td,
            [data-preview-sandbox] th {
              word-wrap: break-word;
              overflow-wrap: break-word;
              word-break: break-word;
            }

            /* Ensure links are visible */
            [data-preview-sandbox] a {
              text-decoration: underline;
              color: #0561e6;
            }

            .dark [data-preview-sandbox] a {
              color: #6db3f8;
            }

            [data-preview-sandbox] p {
              margin-bottom: 1rem;
              margin-top: 1rem;
            }

            [data-preview-sandbox] blockquote {
              margin: 0.5rem 0;
              padding: 0.25rem 0.75rem;
              border-left: 3px solid #d1d5db;
            }

            .dark [data-preview-sandbox] blockquote {
              border-left-color: #4b5563;
            }
          `,
        }}
      />

      {/* Main content */}
      <div
        data-preview-sandbox
        dangerouslySetInnerHTML={{ __html: sanitizedMain }}
      />

      {/* Quoted/forwarded content toggle */}
      {hasQuotedContent && (
        <>
          <button
            onClick={() => setShowQuoted(!showQuoted)}
            className="text-muted-foreground flex items-center gap-1 rounded-md px-4 py-2 text-xs transition-colors"
            type="button"
          >
            <span>{showQuoted ? '▼' : '▶'}</span>
            <span>{showQuoted ? 'Hide' : 'Show'} quoted text</span>
          </button>

          {showQuoted && (
            <div
              data-preview-sandbox
              className="border-border mt-2 border-t pt-2 opacity-70"
              dangerouslySetInnerHTML={{ __html: sanitizedQuoted }}
            />
          )}
        </>
      )}
    </div>
  );
}
