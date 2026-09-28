import { describe, expect, it } from 'vitest';

import { CHAT_ASSISTANT, CHAT_ASSISTANT_SLUG } from './assistant';

/**
 * The instructions are a SUBTRACTIVE contract: persona, product boundary,
 * and safety — never tool-ordering policy, which lives on the wire tool
 * descriptions (`tools.ts`). These tests pin what must stay absent and the
 * few things that must stay present, without snapshotting the prose.
 */

const instructions = CHAT_ASSISTANT.instructions ?? '';

/** The public docs index — fixed, never derived from this deployment's site
 * origin (a self-hosted `TALE_SITE_URL` would point at a docs host that does
 * not exist). */
const TALE_DOCS_INDEX = 'https://docs.tale.dev/llms.txt';

describe('CHAT_ASSISTANT', () => {
  it('keeps the fixed slug the executors audit-log under', () => {
    expect(CHAT_ASSISTANT.slug).toBe(CHAT_ASSISTANT_SLUG);
  });

  it('carries no tool-ordering rules — that steer rides the tool descriptions', () => {
    expect(instructions).not.toMatch(/SEARCH BEFORE/i);
    expect(instructions).not.toMatch(/PRESENT TOOL RESULTS/i);
    expect(instructions).not.toMatch(/FETCH BEFORE QUOTING/i);
    // No numbered rule list at all — subtraction, not a new playbook.
    expect(instructions).not.toMatch(/^\s*\d+\.\s/m);
  });

  it('never sends an empty search to the settings pages as the next step', () => {
    expect(instructions).not.toContain('Documents page');
    expect(instructions).not.toContain('Websites page');
  });

  it('does not restate the untrusted-content rules the context injects', () => {
    expect(instructions).not.toMatch(/untrusted-content markers/i);
  });

  it('keeps persona, honesty, the Task boundary, and the format ban', () => {
    expect(instructions).toMatch(/never invent facts/i);
    expect(instructions).toContain('DELIVERABLES GO TO TASKS');
    expect(instructions).toMatch(/internal formats/i);
    expect(instructions).toMatch(/cite the documents and pages/i);
  });

  it('stays a slim persona and names nothing eval-specific', () => {
    expect(instructions.length).toBeLessThan(1800);
    // Tale's own documentation is the one address the persona may name — it
    // grounds questions about the product itself, not an eval's sources.
    expect(instructions.replaceAll(TALE_DOCS_INDEX, '')).not.toMatch(
      /https?:\/\//,
    );
  });

  it('answers questions about Tale from its documentation, never guessed URLs', () => {
    expect(instructions).toContain('QUESTIONS ABOUT TALE');
    expect(instructions).toContain(TALE_DOCS_INDEX);
    expect(instructions).toMatch(/never guess a docs URL/i);
    expect(instructions).toMatch(/latest release/i);
  });
});
