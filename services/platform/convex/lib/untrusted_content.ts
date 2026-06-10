/**
 * Untrusted-content wrapping for external tool outputs.
 *
 * External tools (web search, integrations, RAG over external sources) return content
 * that originates from untrusted systems and may contain prompt-injection payloads.
 * Wrapping such content in explicit XML tags signals to the LLM that it is DATA, not
 * instructions, and pairs with a system-prompt rule that commands must never be
 * executed from within untrusted blocks.
 */

import { renderPrompt } from './prompts/registry';

type UntrustedSourceMeta = {
  tool: string;
  url?: string;
  operation?: string;
  integration?: string;
};

const MAX_ATTR_LENGTH = 2000;

function escapeAttribute(value: string): string {
  const truncated =
    value.length > MAX_ATTR_LENGTH ? value.slice(0, MAX_ATTR_LENGTH) : value;
  return truncated
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Neutralize literal `<tagName ...>` and `</tagName ...>` substrings inside
 * `content` so the surrounding wrapper tag cannot be broken by attacker
 * text. Used for any prompt section that wraps operator- or user-authored
 * content (skill descriptions, skill bodies, untrusted sources, ...).
 *
 * Replacement uses HTML-entity-escaped angle brackets — readable in the
 * prompt log, but no longer parsed as tags by an XML-aware reader.
 */
export function escapeForXmlTag(value: string, tagName: string): string {
  // Require the tag name to be followed by either `>` or whitespace (then
  // attributes). `\b` would treat `-` as a word boundary and false-match
  // `</skill-description-extra>` against `skill-description`, so for
  // kebab-case tag names we need an explicit terminator check instead.
  const escaped = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const closeRe = new RegExp(`<\\/${escaped}(?:\\s[^>]*)?>`, 'gi');
  const openRe = new RegExp(`<${escaped}(?:\\s[^>]*)?>`, 'gi');
  return value
    .replace(closeRe, `&lt;/${tagName}&gt;`)
    .replace(openRe, `&lt;${tagName}&gt;`);
}

// `sanitizeUntrustedField` was relocated to `lib/shared/` so the client
// optimistic-render path (use-send-message.ts) can call it without
// crossing the convex namespace. Re-export to keep existing convex
// importers (`../untrusted_content`) unchanged.
export { sanitizeUntrustedField } from '../../lib/shared/sanitize-untrusted-field';

export function wrapUntrusted(
  content: string,
  source: UntrustedSourceMeta,
): string {
  const attrs = [`tool="${escapeAttribute(source.tool)}"`];
  if (source.integration) {
    attrs.push(`integration="${escapeAttribute(source.integration)}"`);
  }
  if (source.operation) {
    attrs.push(`operation="${escapeAttribute(source.operation)}"`);
  }
  if (source.url) {
    attrs.push(`url="${escapeAttribute(source.url)}"`);
  }
  const safeContent = escapeForXmlTag(content, 'untrusted_source');
  return `<untrusted_source ${attrs.join(' ')}>\n${safeContent}\n</untrusted_source>`;
}

/**
 * System-prompt addendum that should be included for any agent whose tools
 * return untrusted external content. Explains the wrapping contract to the LLM.
 *
 * The text lives in the prompt registry (`system.untrusted_content`). It feeds
 * the prompt-cache STABLE PREFIX, so any byte change invalidates caches
 * platform-wide — the registry snapshot test guards it. The exported name is
 * kept so importers (e.g. `build_system_prompt.ts`) are unchanged.
 */
export const UNTRUSTED_CONTENT_SYSTEM_PROMPT = renderPrompt(
  'system.untrusted_content',
);

const SUSPICIOUS_PATTERNS = [
  /\[system\s*:/i,
  /\[\[\s*system/i,
  /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions|prompts|rules)/i,
  /disregard\s+(previous|prior|above)\s+(instructions|prompts)/i,
  /<\s*\/?\s*(system|assistant|human|user)\s*>/i,
  /override\s+system\s+prompt/i,
];

/**
 * Defense-in-depth tripwire for tool-input fields that should reject obvious
 * injection payloads. Not a security boundary — the LLM can still rephrase —
 * but catches crude attacks where an untrusted source gets copied verbatim
 * into a privileged operation (update_todos content, request_human_input question, etc.).
 */
export function containsSuspiciousInjection(value: string): boolean {
  return SUSPICIOUS_PATTERNS.some((pattern) => pattern.test(value));
}
