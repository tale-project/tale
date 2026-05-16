import type { StrikeEntry } from '../lib/rules';

/**
 * The English strike list — words that fail review on sight in `docs/en/**`.
 *
 * Sources:
 *   - `.claude/skills/docs/SKILL.md` §"Twelve words to strike"
 *   - `.agents/terminology/TERMINOLOGY_EN.md` §marketing softeners
 *
 * Consumed by `50-voice-en.test.ts`. The rule is simple: each term, case-
 * insensitive, with an ASCII word boundary. `allowIn` carve-outs cover the
 * narrow legitimate uses (the word inside a quoted UI string the test should
 * not blame the docs author for).
 */

export const VOICE_STRIKE_EN: readonly StrikeEntry[] = [
  {
    id: 'en-simply',
    term: 'simply',
    replace: 'delete; the demonstration carries it',
  },
  {
    id: 'en-easy',
    term: 'easy',
    replace: 'delete; if it is easy, the page shows it',
  },
  {
    id: 'en-easily',
    term: 'easily',
    replace: 'delete',
  },
  {
    id: 'en-powerful',
    term: 'powerful',
    replace: 'delete or replace with a concrete capability',
  },
  {
    id: 'en-seamless',
    term: 'seamless',
    replace: 'delete; describe the missing-step that makes it seamless',
  },
  {
    id: 'en-seamlessly',
    term: 'seamlessly',
    replace: 'delete',
  },
  {
    id: 'en-just',
    term: 'just',
    replace: 'delete; the imperative does not need softening',
    // "Just now" as a relative timestamp is a legitimate UI string; quoted
    // UI labels are allowed. Same for `just` as part of `just-in-time` (JIT)
    // technical compounds and `just released`.
    allowIn: [/`[^`]*just[^`]*`/i, /\*\*[^*]*just[^*]*\*\*/i, /just-in-time/i],
  },
  {
    id: 'en-please',
    term: 'please',
    replace: 'delete; imperative does the work',
  },
  {
    id: 'en-feel-free-to',
    term: 'feel free to',
    replace: 'delete; just give the instruction',
  },
  {
    id: 'en-discover',
    term: 'discover',
    replace: 'replace with "read", "open", or "see"',
  },
  {
    id: 'en-unleash',
    term: 'unleash',
    replace: 'delete or replace with the concrete action',
  },
  {
    id: 'en-effortlessly',
    term: 'effortlessly',
    replace: 'delete',
  },
  {
    id: 'en-straightforward',
    term: 'straightforward',
    replace: 'delete; the page shows the shape',
  },
  {
    id: 'en-intuitive',
    term: 'intuitive',
    replace: 'delete; the screenshot shows it',
  },
];
