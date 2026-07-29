'use node';

/**
 * Config-domain registry — Layer B (filesystem path resolvers).
 *
 * Layer A (`lib/shared/config/registry.ts`) declares the domains as pure
 * data and cannot reference the per-domain `resolve<Domain>Dir` functions,
 * because those live in `'use node'` `file_utils.ts` modules. This is the
 * ONE place that value-imports them, keyed by `ConfigDomain.name`, so the
 * scaffolder and the generic file→cache sync resolve a domain's on-disk dir
 * without each re-importing every resolver. Never imported by V8 code.
 *
 * Rebuilt AI-backend domains add their resolver here as
 * their phases land.
 */

import { resolveAgentsDir } from '../../agents/file_utils';
import { resolveSsoDir } from '../../enterprise_sso/file_utils';
import { resolveGovernanceDir } from '../../governance/file_utils';
import { resolveSkillsDir } from '../../skills/file_utils';
import { resolveProvidersDir } from '../providers/org_providers';

export type DomainDirResolver = (orgSlug: string) => string;

/** `ConfigDomain.name` → absolute on-disk domain dir for an org. */
export const DOMAIN_DIR_RESOLVERS: Record<string, DomainDirResolver> = {
  governance: resolveGovernanceDir,
  // `sso` is nested under governance — resolves to `<org>/governance/sso/`.
  sso: resolveSsoDir,
  // Org-defined custom AI-provider connectors (`<org>/providers/*.yml`),
  // read node-direct by the provider-resolution modules.
  providers: resolveProvidersDir,
  // Skill bundles (`<org>/skills/<slug>/SKILL.md` + assets), read node-direct
  // when staging a sandbox and when a turn expands a skill.
  skills: resolveSkillsDir,
  // Agent personas (`<org>/agents/<slug>.yml`), read node-direct by the
  // org-facing editor and by the turn that resolves who is answering.
  agents: resolveAgentsDir,
};

/** Resolve a domain's dir for an org, throwing if the domain has no resolver. */
export function resolveDomainDir(domain: string, orgSlug: string): string {
  const resolver = DOMAIN_DIR_RESOLVERS[domain];
  if (!resolver) {
    throw new Error(
      `No directory resolver registered for config domain: ${domain}`,
    );
  }
  return resolver(orgSlug);
}
