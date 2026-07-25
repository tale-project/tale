/**
 * Rebind an automation manifest from one integration slug to another — the pure
 * core of "Duplicate integration". Rewrites ONLY the fields that name the
 * integration by slug, and ONLY where the value exactly equals `fromSlug`:
 *
 *   - `requires.integrations[]` (slug strings) — drives the install row's
 *     `requiredIntegrations` and, for an inbox automation, the channel binding;
 *   - `integrations[]` (the "provides" display array, when present);
 *   - `workflow.requires.integrations[].name`;
 *   - each `workflow.steps[].config.parameters.name` on an `integration`-type
 *     step (the runtime resolves the integration by `name`);
 *   - each `workflow.steps[].config.parameters.integrationName` on a
 *     `conversation`-type step (resolved by `integrationName`).
 *
 * Everything else — template strings (`{{steps…}}`), operations, step display
 * names, other integrations in a multi-integration automation, the
 * `builtinViews` opt-in — is left byte-for-byte intact. Operates on the raw
 * parsed JSON (a deep clone), so no manifest field is ever dropped by a schema
 * round-trip. Pure and dependency-free for direct unit testing.
 */

import { isRecord } from '../../lib/utils/type-utils';

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | undefined {
  return isRecord(value) ? value : undefined;
}

export function rebindManifestIntegration(
  manifest: JsonObject,
  fromSlug: string,
  toSlug: string,
): JsonObject {
  // Deep clone via JSON round-trip: the manifest is pure JSON, so this is a
  // faithful copy and keeps the rewrite from mutating the caller's object.
  const clone: unknown = JSON.parse(JSON.stringify(manifest));
  const next: JsonObject = isRecord(clone) ? clone : {};
  const swap = (value: unknown): unknown =>
    value === fromSlug ? toSlug : value;

  // 1. requires.integrations : string[]
  const requires = asObject(next.requires);
  if (requires && Array.isArray(requires.integrations)) {
    requires.integrations = requires.integrations.map(swap);
  }

  // 2. integrations : string[]  (the "provides" display array)
  if (Array.isArray(next.integrations)) {
    next.integrations = next.integrations.map(swap);
  }

  const workflow = asObject(next.workflow);

  // 3. workflow.requires.integrations : { name, ... }[]
  const workflowRequires = workflow && asObject(workflow.requires);
  if (workflowRequires && Array.isArray(workflowRequires.integrations)) {
    for (const dep of workflowRequires.integrations) {
      const entry = asObject(dep);
      if (entry && entry.name === fromSlug) entry.name = toSlug;
    }
  }

  // 4. workflow.steps[].config.parameters.{name|integrationName}
  const steps = workflow && Array.isArray(workflow.steps) ? workflow.steps : [];
  for (const rawStep of steps) {
    const config = asObject(asObject(rawStep)?.config);
    const params = config && asObject(config.parameters);
    if (!config || !params) continue;
    // Integration-type steps name the integration via `name`; conversation-type
    // steps via `integrationName`. Gate on `config.type` + exact-slug match so a
    // step display `name` (or any other field) is never touched.
    if (config.type === 'integration' && params.name === fromSlug) {
      params.name = toSlug;
    }
    if (config.type === 'conversation' && params.integrationName === fromSlug) {
      params.integrationName = toSlug;
    }
  }

  return next;
}
