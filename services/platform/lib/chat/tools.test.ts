import { describe, expect, it } from 'vitest';

import {
  CHAT_TOOL_DOCS,
  CHAT_TOOL_NAMES,
  CHAT_WIRE_TOOLS,
  RAG_SEARCH_DEFAULT_LIMIT,
  RAG_SEARCH_ENTITY_LIMIT,
  RAG_SEARCH_MAX_LIMIT,
  RAG_SEARCH_MIN_SIMILARITY,
} from './tools';

/**
 * The wire descriptions are the PRIMARY steer — when to call, when not to,
 * what comes back, and which tool follows — while the system prompt carries
 * only a one-line summary per tool. These tests lock the load-bearing
 * clauses of that contract without freezing the prose: a rewrite may say it
 * differently, but it may not stop saying it.
 */

function wireDescription(name: string): string {
  const tool = CHAT_WIRE_TOOLS.find((entry) => entry.name === name);
  if (!tool) throw new Error(`no wire tool named ${name}`);
  return tool.description;
}

describe('CHAT_WIRE_TOOLS — the model-facing contract', () => {
  it('covers exactly the fixed loadout, in order', () => {
    expect(CHAT_WIRE_TOOLS.map((tool) => tool.name)).toEqual([
      ...CHAT_TOOL_NAMES,
    ]);
  });

  it('rag_search says when NOT to call and where to go on empty', () => {
    const text = wireDescription('rag_search');
    expect(text).toMatch(/not for general knowledge/i);
    expect(text).toMatch(/do not\s+re-run reworded/i);
    expect(text).toContain('web_fetch');
  });

  it('rag_search is honest that only document and web-page rows carry a ref', () => {
    const text = wireDescription('rag_search');
    expect(text).toMatch(/only document and web-page rows carry a "ref"/i);
    expect(text).toMatch(/cannot\s+be fetched/i);
  });

  it('rag_search explains the score as ordering, not similarity', () => {
    expect(wireDescription('rag_search')).toMatch(
      /"score"\s+orders hits within one response only/i,
    );
  });

  it('rag_fetch owns fetch-before-quoting and the direct attachment path', () => {
    const text = wireDescription('rag_fetch');
    expect(text).toMatch(/fetch before quoting/i);
    expect(text).toMatch(/do not rag_search .* whose ref you\s+already hold/i);
  });

  it('web_fetch is the escalation when org knowledge did not answer', () => {
    const text = wireDescription('web_fetch');
    expect(text).toMatch(/knowledge did not answer/i);
    expect(text).toContain('rag_fetch');
    // The old wording walled the tool off from anything org-adjacent.
    expect(text).not.toMatch(/only for pages outside/i);
  });

  it('names no real-world domain — steering is generic, never per-eval', () => {
    for (const tool of CHAT_WIRE_TOOLS) {
      expect(tool.description).not.toMatch(/https:\/\/[a-z0-9]/i);
      expect(tool.description).not.toMatch(/\b[a-z0-9-]+\.(com|org|net|io)\b/i);
    }
  });
});

describe('CHAT_TOOL_DOCS — the system-prompt one-liners', () => {
  it('is one short line per tool, far shorter than the wire description', () => {
    for (const doc of CHAT_TOOL_DOCS) {
      expect(doc.description).not.toContain('\n');
      expect(doc.description.length).toBeLessThan(120);
      expect(doc.description.length).toBeLessThan(
        wireDescription(doc.id).length / 2,
      );
    }
  });

  it('lists every tool exactly once, in loadout order', () => {
    expect(CHAT_TOOL_DOCS.map((doc) => doc.id)).toEqual([...CHAT_TOOL_NAMES]);
  });
});

describe('rag_search constants', () => {
  it('keeps the similarity floor inside the cosine range', () => {
    expect(RAG_SEARCH_MIN_SIMILARITY).toBeGreaterThan(0);
    expect(RAG_SEARCH_MIN_SIMILARITY).toBeLessThan(1);
  });

  it('orders the caps: entity leg ≤ default ≤ max', () => {
    expect(RAG_SEARCH_ENTITY_LIMIT).toBeLessThanOrEqual(
      RAG_SEARCH_DEFAULT_LIMIT,
    );
    expect(RAG_SEARCH_DEFAULT_LIMIT).toBeLessThanOrEqual(RAG_SEARCH_MAX_LIMIT);
  });
});
