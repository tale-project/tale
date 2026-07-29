// The harness registry, config-first: a harness IS its fact file
// (`configs/platform/system/harnesses/<slug>/harness.yml`). `composeHarnessGlue`
// turns one validated fact into the `HarnessGlue` surface — `buildExec` is
// the generic interpreter (`exec-builder.ts`) bound to the fact's `exec`
// section, `createParser` the slug-bound parser family named by its `parser`
// field. There are no per-slug code modules.
//
// Validation lives in layers that cannot drift from behavior:
//  - `harnessConnectorSchema` holds each file internally coherent (declared
//    capabilities/transport must match the exec facts — the schema's
//    superRefine replaced the old behavior-probing validator);
//  - `validateHarnessFacts` holds the SET coherent with `HARNESS_SLUGS`
//    (every shipped slug has exactly one fact and vice versa);
//  - the golden exec fixtures + interpreter tests pin what the composed
//    glue actually builds.
//
// This module stays pure (no `node:*` value imports, no convex imports); the
// caller loads the YAML facts — `loadHarnesses()` in
// `convex/lib/providers/load_system_config.ts` — and passes them in.

import type { HarnessConnector } from '../shared/schemas/providers';
import { buildHarnessExec } from './exec-builder';
import { PARSER_FAMILIES } from './parsers';
import type { HarnessGlue } from './types';
import { HARNESS_SLUGS, isHarnessSlug, type HarnessSlug } from './types';

/** Composed-glue cache. The loader memoizes and returns stable fact
 * references, so keying on the fact object gives every caller the same glue
 * instance until the underlying file actually changes. */
const composed = new WeakMap<HarnessConnector, HarnessGlue>();

/**
 * The glue surface for one validated harness fact: exec building via the
 * generic interpreter, stream parsing via the named family. Pure and
 * memoized per fact reference.
 */
export function composeHarnessGlue(fact: HarnessConnector): HarnessGlue {
  const cached = composed.get(fact);
  if (cached) return cached;
  const slug = fact.slug;
  if (!isHarnessSlug(slug)) {
    throw new Error(
      `[harnesses] fact "${slug}" names no shipped harness slug — add it to HARNESS_SLUGS or fix the fact file`,
    );
  }
  const family = PARSER_FAMILIES[fact.parser];
  const glue: HarnessGlue = {
    slug,
    buildExec: (spec) => buildHarnessExec(fact, spec),
    createParser: () => family(slug),
  };
  composed.set(fact, glue);
  return glue;
}

/**
 * The glue for a shipped harness slug, composed from the loaded YAML facts.
 * The caller passes the facts in (the registry stays pure); a slug without a
 * fact is a packaging defect and throws.
 */
export function getHarnessGlue(
  slug: HarnessSlug,
  facts: readonly HarnessConnector[],
): HarnessGlue {
  const fact = facts.find((f) => f.slug === slug);
  if (!fact) {
    throw new Error(`[harnesses] no fact file loaded for slug "${slug}"`);
  }
  return composeHarnessGlue(fact);
}

/**
 * Enforce the 1:1 slug ↔ fact pairing over the loaded YAML facts. Throws a
 * single error listing EVERY inconsistency (a packaging/config defect is
 * fixed in one round-trip, not one message at a time): every shipped slug
 * has exactly one fact, and every fact names a shipped slug. Per-file
 * coherence (parser family, exec facts vs capabilities) is the schema's job
 * and already ran in the loader.
 */
export function validateHarnessFacts(facts: readonly HarnessConnector[]): void {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const fact of facts) {
    if (seen.has(fact.slug)) {
      problems.push(`duplicate harness fact for slug "${fact.slug}"`);
    }
    seen.add(fact.slug);
    if (!isHarnessSlug(fact.slug)) {
      problems.push(`fact "${fact.slug}" names no shipped harness slug`);
    }
  }
  for (const slug of HARNESS_SLUGS) {
    if (!seen.has(slug)) {
      problems.push(`shipped harness "${slug}" has no fact file`);
    }
  }
  if (problems.length > 0) {
    throw new Error(
      `[harnesses] slug ↔ fact pairing violated:\n - ${problems.join('\n - ')}`,
    );
  }
}
