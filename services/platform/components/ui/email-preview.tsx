'use client';

import { CSSProperties, useMemo, useState } from 'react';
import DOMPurify from 'dompurify';
import { cn } from '@/lib/utils/cn';

export interface EmailPreviewProps {
  html: string;
  className?: string;
  style?: CSSProperties;
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

export function sanitizePreviewHtml(html: string): string {
  // First, remove plain text quote markers (> at start of lines)
  const processed = html
    // Remove &gt; entities at the start of lines (with optional spaces)
    .replace(/^(&gt;\s*)+/gm, '')
    // Remove > characters at the start of lines (with optional spaces)
    .replace(/^(>\s*)+/gm, '')
    // Remove quote markers after line breaks
    .replace(/(<br\s*\/?>\s*)(&gt;\s*)+/gi, '$1')
    .replace(/(<br\s*\/?>\s*)(>\s*)+/gi, '$1');

  // Add hooks to preserve styles and modify links
  DOMPurify.addHook('uponSanitizeElement', (node) => {
    if (node instanceof Element && node.hasAttribute('style')) {
      const styleAttr = node.getAttribute('style');
      if (styleAttr) {
        (node as any).__originalStyle = styleAttr;
      }
    }
  });

  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (!(node instanceof Element)) return;

    if ((node as any).__originalStyle) {
      node.setAttribute('style', (node as any).__originalStyle);
      delete (node as any).__originalStyle;
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

  DOMPurify.removeHook('uponSanitizeElement');
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
        main: html.substring(0, match.index).trim(),
        quoted: html.substring(match.index).trim(),
      };
    }
  }

  return { main: html, quoted: '' };
}

export function EmailPreview({ html, className, style }: EmailPreviewProps) {
  const [showQuoted, setShowQuoted] = useState(false);

  const { sanitizedMain, sanitizedQuoted } = useMemo(() => {
    const { main, quoted } = splitQuotedContent(html);
    return {
      sanitizedMain: sanitizePreviewHtml(main),
      sanitizedQuoted: quoted ? sanitizePreviewHtml(quoted) : '',
    };
  }, [html]);

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
              /* Default email background and text color for emails without explicit styling */
              background-color: white;
              color: black;
              /* Add padding to create visual separation from container */
              padding: 1rem;
              border-radius: 0.375rem;
              /* Prevent content from expanding beyond container */
              overflow-x: auto;
              max-width: 100%;
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
              color: inherit;
              text-decoration: underline;
              color: #0561e6;
            }

            [data-preview-sandbox] p {
              margin-bottom: 1rem;
              margin-top: 1rem;
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
            className="text-xs text-muted-foreground hover:text-foreground mt-2 flex items-center gap-1 transition-colors"
            type="button"
          >
            <span>{showQuoted ? '▼' : '▶'}</span>
            <span>{showQuoted ? 'Hide' : 'Show'} quoted text</span>
          </button>

          {showQuoted && (
            <div
              data-preview-sandbox
              className="mt-2 pt-2 border-t border-border opacity-70"
              dangerouslySetInnerHTML={{ __html: sanitizedQuoted }}
            />
          )}
        </>
      )}
    </div>
  );
}
