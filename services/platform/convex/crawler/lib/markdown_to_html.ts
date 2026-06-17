'use node';

/**
 * Markdown → HTML conversion + the default render template.
 *
 * Ports `services/crawler/app/services/base_converter.py`:
 *   - `markdown_to_html()` used markdown-it-py (CommonMark + tables). Here we use
 *     the unified/remark mdast pipeline already vendored into the platform
 *     (transitively via `react-markdown`): `mdast-util-from-markdown` +
 *     `mdast-util-gfm` (GFM tables/strikethrough/etc.) → `mdast-util-to-hast` →
 *     `hast-util-to-html`. GFM is a superset of the CommonMark+table behaviour
 *     the Python side enabled, so table fidelity is preserved.
 *   - `DEFAULT_HTML_TEMPLATE` / `_wrap_html()` are reproduced verbatim so the
 *     rendered PDFs/images keep the same typography, multi-language font stack,
 *     and code/table/quote styling the crawler produced.
 *   - `_inject_css()` mirrors the Python robust-injection strategy for the
 *     non-wrapped HTML path.
 *
 * // TODO(verify): the Python markdown-it ran CommonMark with only the `table`
 * plugin enabled; the GFM mdast extension additionally enables autolink
 * literals, strikethrough, task lists, and footnotes. These are strict
 * additions (they only render MORE markdown features) so existing inputs render
 * identically; flag if a downstream consumer relied on a feature being INERT.
 */

import { toHtml } from 'hast-util-to-html';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { toHast } from 'mdast-util-to-hast';
import { gfm } from 'micromark-extension-gfm';

/**
 * Default HTML template for rendering content. Ported verbatim from
 * `base_converter.py::DEFAULT_HTML_TEMPLATE` (Noto multi-language font stack +
 * emoji + the document typography). `{content}` / `{extra_head}` placeholders
 * become template parameters.
 */
const TEMPLATE_HEAD = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        * { box-sizing: border-box; }
        body {
            font-family: 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans CJK JP', 'Noto Sans CJK KR',
                'DejaVu Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
            line-height: 1.8;
            color: #333;
            max-width: 800px;
            margin: 0 auto;
            padding: 40px;
            background: white;
        }
        h1 { font-size: 2em; margin-top: 0; border-bottom: 2px solid #eee; padding-bottom: 0.3em; }
        h2 { font-size: 1.5em; border-bottom: 1px solid #eee; padding-bottom: 0.3em; }
        h3 { font-size: 1.25em; }
        code {
            background: #f5f5f5;
            padding: 2px 6px;
            border-radius: 4px;
            font-family: 'Noto Sans Mono', 'DejaVu Sans Mono', 'SF Mono', Consolas, 'Liberation Mono', Menlo, monospace;
            font-size: 0.9em;
        }
        pre {
            background: #f5f5f5;
            padding: 16px;
            border-radius: 8px;
            overflow-x: auto;
        }
        pre code { background: none; padding: 0; }
        blockquote {
            border-left: 4px solid #ddd;
            margin: 0;
            padding-left: 16px;
            color: #666;
        }
        table {
            border-collapse: collapse;
            width: 100%;
            margin: 1em 0;
        }
        th, td {
            border: 1px solid #ddd;
            padding: 8px 12px;
            text-align: left;
        }
        th { background: #f5f5f5; font-weight: 600; }
        img { max-width: 100%; height: auto; }
        a { color: #0066cc; }
        hr { border: none; border-top: 1px solid #eee; margin: 2em 0; }
        ul, ol { padding-left: 2em; }
        li { margin: 0.5em 0; }
    </style>
`;

const TEMPLATE_TAIL = `</head>
<body>
`;

/** Convert markdown to HTML (GFM-flavoured). Mirrors `markdown_to_html()`. */
export function markdownToHtml(markdown: string): string {
  const tree = fromMarkdown(markdown, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });
  const hast = toHast(tree);
  return toHtml(hast);
}

/** Wrap rendered content in the default template. Mirrors `_wrap_html()`. */
export function wrapHtml(content: string, extraHead = ''): string {
  return `${TEMPLATE_HEAD}    ${extraHead}\n${TEMPLATE_TAIL}    ${content}\n</body>\n</html>\n`;
}

/**
 * Inject CSS into an existing HTML document robustly. Ports
 * `pdf_service.py::_inject_css` injection strategy:
 *   1. Before `</head>` (case-insensitive)
 *   2. After `<head ...>` if no closing tag
 *   3. Before `<body ...>` if no head
 *   4. Prepend as a fallback
 */
export function injectCss(html: string, css: string): string {
  if (!css || css.trim().length === 0) {
    return html;
  }
  const styleBlock = `<style>${css}</style>`;

  const headClose = /<\/head\s*>/i.exec(html);
  if (headClose) {
    const pos = headClose.index;
    return html.slice(0, pos) + styleBlock + html.slice(pos);
  }

  const headOpen = /<head(?:\s[^>]*)?>/i.exec(html);
  if (headOpen) {
    const pos = headOpen.index + headOpen[0].length;
    return html.slice(0, pos) + styleBlock + html.slice(pos);
  }

  const bodyOpen = /<body(?:\s[^>]*)?>/i.exec(html);
  if (bodyOpen) {
    const pos = bodyOpen.index;
    return html.slice(0, pos) + styleBlock + html.slice(pos);
  }

  return styleBlock + html;
}
