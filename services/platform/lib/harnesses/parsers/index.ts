// The parser-family table: `parser: <family>` in a harness YAML resolves
// here. Stream parsing is the one genuinely stateful per-harness part that
// stays code (sub-agent nesting, retry-hold state machines, background-task
// ledgers); everything exec-side is declarative YAML interpreted by
// `../exec-builder`. A family is slug-parameterized so shared dialects
// (gemini-stream serves gemini AND its qwen-code fork) still attribute
// events to the harness that ran.

import type { ParserFamily } from '../../shared/schemas/providers';
import type { HarnessEventParser, HarnessSlug } from '../types';
import { createParser as claudeStreamJson } from './claude-stream-json';
import { createParser as codexJsonl } from './codex-jsonl';
import { createParser as cursorJsonl } from './cursor-jsonl';
import { createParser as geminiStream } from './gemini-stream';
import { createParser as hermesJsonl } from './hermes-jsonl';
import { createParser as openclawJsonl } from './openclaw-jsonl';
import { createParser as opencodeJsonl } from './opencode-jsonl';
import { createParser as piJsonl } from './pi-jsonl';

/**
 * Family → slug-bound parser factory. The mapped type is exhaustive over the
 * schema's `parserFamilySchema` enum: adding a family to the schema without
 * a factory here (or vice versa) is a compile error.
 */
export const PARSER_FAMILIES: {
  readonly [F in ParserFamily]: (slug: HarnessSlug) => HarnessEventParser;
} = {
  'claude-stream-json': claudeStreamJson,
  'codex-jsonl': codexJsonl,
  'cursor-jsonl': cursorJsonl,
  'gemini-stream': geminiStream,
  'hermes-jsonl': hermesJsonl,
  'openclaw-jsonl': openclawJsonl,
  'opencode-jsonl': opencodeJsonl,
  'pi-jsonl': piJsonl,
};
