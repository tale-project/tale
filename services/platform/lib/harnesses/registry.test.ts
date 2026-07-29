// Registry gates, config-first. The shipped YAML tree
// (configs/platform/system/harnesses/, found via the loader's repo walk-up)
// is the fixture. Two layers are proven here:
//
//  - `validateHarnessFacts` — the SET pairing: every shipped slug has
//    exactly one fact and every fact names a shipped slug.
//  - `harnessDefinitionSchema` coherence — the per-file refinements that
//    replaced the old behavior-probing validator: declared capabilities /
//    transport / credential policy must match the exec facts. The
//    failure-mode cases doctor a cloned RAW fact and assert the schema
//    names the exact inconsistency.
//
// What the composed glue BUILDS is pinned elsewhere: golden-exec.test.ts
// (byte-for-byte fixtures) and exec-builder.test.ts (hygiene invariants).

import { describe, expect, it } from 'vitest';

import { loadHarnesses } from '../../convex/lib/providers/load_system_config';
import {
  harnessDefinitionSchema,
  type HarnessDefinition,
} from '../shared/schemas/providers';
import {
  composeHarnessGlue,
  getHarnessGlue,
  validateHarnessFacts,
} from './registry';
import { HARNESS_SLUGS } from './types';

/** Deep-cloned shipped facts, safe to doctor (the loader caches and returns
 * stable references — mutating those would poison sibling tests). */
function clonedFacts(): HarnessDefinition[] {
  return structuredClone([...loadHarnesses()]);
}

/** The clone of one slug's fact, for targeted doctoring. */
function factOf(facts: HarnessDefinition[], slug: string): HarnessDefinition {
  const fact = facts.find((f) => f.slug === slug);
  if (!fact) throw new Error(`shipped facts miss "${slug}"`);
  return fact;
}

/** Re-validate one doctored fact through the schema and return the joined
 * issue messages ('' when it still validates). */
function schemaProblems(fact: HarnessDefinition): string {
  const result = harnessDefinitionSchema.safeParse(fact);
  return result.success
    ? ''
    : result.error.issues.map((i) => i.message).join('\n');
}

describe('harness glue composition', () => {
  it('composes a glue surface for every shipped fact', () => {
    const facts = loadHarnesses();
    expect(facts.map((f) => f.slug).sort()).toEqual([...HARNESS_SLUGS].sort());
    for (const fact of facts) {
      const glue = composeHarnessGlue(fact);
      expect(glue.slug).toBe(fact.slug);
      expect(typeof glue.buildExec).toBe('function');
      // The parser attributes events to the harness that ran (families are
      // shared — gemini-stream serves gemini AND qwen-code).
      const parser = glue.createParser();
      const events = parser.feed(
        `${JSON.stringify({ type: 'not-a-real-event' })}\n`,
      );
      expect(events.at(-1)).toMatchObject({ harness: fact.slug });
    }
  });

  it('memoizes per fact reference and resolves by slug', () => {
    const facts = loadHarnesses();
    const glue = getHarnessGlue('gemini', facts);
    expect(getHarnessGlue('gemini', facts)).toBe(glue);
    expect(composeHarnessGlue(factOf([...facts], 'gemini'))).toBe(glue);
  });

  it('throws for a slug with no loaded fact', () => {
    expect(() => getHarnessGlue('gemini', [])).toThrow(
      /no fact file loaded for slug "gemini"/,
    );
  });
});

describe('slug ↔ fact pairing (shipped YAML tree)', () => {
  it('accepts the shipped facts', () => {
    expect(() => validateHarnessFacts(loadHarnesses())).not.toThrow();
  });

  it('rejects a fact set missing a shipped slug', () => {
    const facts = clonedFacts().filter((f) => f.slug !== 'pi');
    expect(() => validateHarnessFacts(facts)).toThrow(
      /shipped harness "pi" has no fact file/,
    );
  });

  it('rejects a fact naming no shipped slug', () => {
    const facts = clonedFacts();
    factOf(facts, 'codex').slug = 'codex-nightly';
    expect(() => validateHarnessFacts(facts)).toThrow(
      /"codex-nightly" names no shipped harness slug/,
    );
  });

  it('rejects duplicate facts for one slug', () => {
    const facts = clonedFacts();
    facts.push(structuredClone(factOf(facts, 'gemini')));
    expect(() => validateHarnessFacts(facts)).toThrow(
      /duplicate harness fact for slug "gemini"/,
    );
  });

  it('reports every inconsistency at once', () => {
    const facts = clonedFacts().filter((f) => f.slug !== 'pi');
    factOf(facts, 'codex').slug = 'codex-nightly';
    let message = '';
    try {
      validateHarnessFacts(facts);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/shipped harness "pi" has no fact file/);
    expect(message).toMatch(/shipped harness "codex" has no fact file/);
    expect(message).toMatch(/"codex-nightly" names no shipped harness slug/);
  });
});

describe('schema coherence (the retired behavior-probing validator)', () => {
  it('accepts every shipped fact unchanged', () => {
    for (const fact of clonedFacts()) {
      expect(schemaProblems(fact)).toBe('');
    }
  });

  it('rejects a steering declaration without the held-stdin channel', () => {
    const facts = clonedFacts();
    const hermes = factOf(facts, 'hermes');
    hermes.capabilities.steering = true;
    expect(schemaProblems(hermes)).toMatch(
      /capabilities\.steering must match the ndjson-user-message stdin mode/,
    );
  });

  it('rejects hiding an implemented steering channel', () => {
    const facts = clonedFacts();
    const claude = factOf(facts, 'claude-code');
    claude.capabilities.steering = false;
    expect(schemaProblems(claude)).toMatch(
      /capabilities\.steering must match the ndjson-user-message stdin mode/,
    );
  });

  it('rejects a plan-mode declaration without a posture slot', () => {
    const facts = clonedFacts();
    const codex = factOf(facts, 'codex');
    codex.capabilities.planMode = true;
    expect(schemaProblems(codex)).toMatch(
      /capabilities\.planMode must match the presence of an argv posture slot/,
    );
  });

  it('rejects an MCP declaration without a mounting channel (silent mount drop)', () => {
    const facts = clonedFacts();
    const cursor = factOf(facts, 'cursor');
    cursor.capabilities.mcp = true;
    expect(schemaProblems(cursor)).toMatch(
      /capabilities\.mcp must match the presence of an MCP mounting channel/,
    );
  });

  it('rejects hiding an implemented MCP mount', () => {
    const facts = clonedFacts();
    const gemini = factOf(facts, 'gemini');
    gemini.capabilities.mcp = false;
    expect(schemaProblems(gemini)).toMatch(
      /capabilities\.mcp must match the presence of an MCP mounting channel/,
    );
  });

  it('rejects a transport fact contradicting the stdin mode', () => {
    const facts = clonedFacts();
    const codex = factOf(facts, 'codex');
    codex.promptTransport = 'argv';
    expect(schemaProblems(codex)).toMatch(
      /promptTransport argv requires stdin mode none and an argv prompt slot/,
    );
  });

  it('rejects managed exec sections behind a managed:false policy', () => {
    const facts = clonedFacts();
    const hermes = factOf(facts, 'hermes');
    hermes.credentialPolicy.managed = false;
    expect(schemaProblems(hermes)).toMatch(
      /managed-only exec sections require credentialPolicy\.managed true/,
    );
  });

  it('rejects a second instructions delivery channel', () => {
    const facts = clonedFacts();
    const gemini = factOf(facts, 'gemini');
    // The envelope already delivers instructions; adding an argv flag
    // delivery makes two.
    gemini.exec.argv.push({ instructions: { flag: '--append' } });
    expect(schemaProblems(gemini)).toMatch(
      /instructions may use at most one delivery channel/,
    );
  });

  it('rejects staged instructions without their doc reference', () => {
    const facts = clonedFacts();
    const cursor = factOf(facts, 'cursor');
    cursor.exec.stagedInstructions = { pathTemplate: 'x/${execId}.md' };
    expect(schemaProblems(cursor)).toMatch(
      /stagedInstructions and an instructionsRef doc fragment require each other/,
    );
  });
});
