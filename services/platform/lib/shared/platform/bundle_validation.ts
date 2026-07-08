/**
 * Bundle-shape assertions shared by the install-time gate
 * (`convex/automations/install_bundle_actions.ts`) and the builtin-catalog test gate
 * (`convex/workflow_engine/helpers/validation/builtin_apps.test.ts`) — one rule
 * set, so a bundle that passes the test is guaranteed to pass at install, and
 * vice versa.
 *
 * A BUNDLE ships `bundle.json` (parsed by `bundleManifestSchema`) declaring
 * `bundle.members` — its own manifest kind, distinct from an automation's
 * `automation.json` (see `automations.ts`). Installing it installs each member
 * (an ordinary, `hidden: true` automation) through one aggregated wizard. A
 * bundle carries NO install-bearing fields of its own: it does nothing by
 * itself. The strict `bundleManifestSchema` already forbids those fields at
 * parse time; this gate re-checks them (defense-in-depth) and owns the member
 * checks a schema cannot see (existence, `hidden`, scope parity).
 *
 * Pure (no I/O) — the caller resolves `members` (from disk at install time,
 * from an in-memory fixture in the test) and hands the parsed manifests in.
 */
import {
  type AutomationManifest,
  type AutomationScope,
  automationScope,
} from '../schemas/automations';

/**
 * The subset of a bundle manifest `validateBundleShape` reads. A parsed
 * `BundleManifest` satisfies it; the install-bearing fields are typed optional
 * so the gate can still flag a hand-built manifest that carries them (they can
 * never reach it from the strict schema, but the check documents the rule).
 */
interface BundleShapeInput {
  scope?: AutomationScope;
  bundle?: { members: string[] };
  workflows?: string[];
  agents?: string[];
  requires?: { integrations?: string[] };
}

type BundleShapeErrorCode =
  | 'NOT_A_BUNDLE'
  | 'HAS_INSTALL_FIELDS'
  | 'MEMBER_MISSING'
  | 'MEMBER_NOT_HIDDEN'
  | 'SCOPE_MISMATCH';

interface BundleShapeError {
  code: BundleShapeErrorCode;
  message: string;
}

/**
 * Validate one bundle manifest against its resolved members. `members` maps
 * every slug the bundle DECLARES to that member's parsed manifest, or `null`
 * when it could not be resolved (missing dir, unparsable `automation.json`) — a
 * `null` still reports a `MEMBER_MISSING` error rather than throwing, so a
 * caller can collect every problem in one pass.
 */
export function validateBundleShape(
  bundleSlug: string,
  bundle: BundleShapeInput,
  members: ReadonlyMap<string, AutomationManifest | null>,
): BundleShapeError[] {
  const errors: BundleShapeError[] = [];

  if (!bundle.bundle) {
    errors.push({
      code: 'NOT_A_BUNDLE',
      message: `"${bundleSlug}" is not a bundle (no bundle.members declared)`,
    });
    return errors;
  }

  const hasInstallFields =
    (bundle.workflows?.length ?? 0) > 0 ||
    (bundle.agents?.length ?? 0) > 0 ||
    (bundle.requires?.integrations?.length ?? 0) > 0;
  if (hasInstallFields) {
    errors.push({
      code: 'HAS_INSTALL_FIELDS',
      message: `Bundle "${bundleSlug}" must not declare its own workflows/agents/requires — it only aggregates its members' installs`,
    });
  }

  const bundleScope: AutomationScope = automationScope(bundle);
  for (const memberSlug of bundle.bundle.members) {
    const member = members.get(memberSlug) ?? null;
    if (!member) {
      errors.push({
        code: 'MEMBER_MISSING',
        message: `Bundle "${bundleSlug}" member "${memberSlug}" does not exist`,
      });
      continue;
    }
    if (member.hidden !== true) {
      errors.push({
        code: 'MEMBER_NOT_HIDDEN',
        message: `Bundle "${bundleSlug}" member "${memberSlug}" must be hidden:true`,
      });
    }
    const memberScope = automationScope(member);
    if (memberScope !== bundleScope) {
      errors.push({
        code: 'SCOPE_MISMATCH',
        message: `Bundle "${bundleSlug}" member "${memberSlug}" has scope "${memberScope}", expected "${bundleScope}" (the bundle's own scope) — every member must share it`,
      });
    }
  }

  return errors;
}
