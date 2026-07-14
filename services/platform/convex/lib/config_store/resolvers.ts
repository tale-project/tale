'use node';

/**
 * Layer B of the config-domain registry: the filesystem path resolvers.
 *
 * The V8-safe registry (`lib/shared/config/registry.ts`, Layer A) declares the
 * set of domains as pure data; it cannot reference the per-domain
 * `resolve<Domain>Dir` functions because those live in `'use node'`
 * `file_utils.ts` modules (they call `node:path` / `getConfigRoot`). This is the
 * ONE place that value-imports them, keyed by `ConfigDomain.name`, so the
 * scaffold and the generic file→cache sync action resolve a domain's on-disk
 * dir without re-importing each resolver. Never imported by V8 code.
 */

import { resolveAgentsDir } from '../../agents/file_utils';
import { resolveAutomationsDir } from '../../automations/file_utils';
import { resolveBrandingDir } from '../../branding/file_utils';
import { resolveSsoDir } from '../../enterprise_sso/file_utils';
import { resolveGovernanceDir } from '../../governance/file_utils';
import { resolveIntegrationsDir } from '../../integrations/file_utils';
import { resolvePromptsDir } from '../../prompts/file_utils';
import { resolveProvidersDir } from '../../providers/file_utils';
import { resolveSkillsDir } from '../../skills/file_utils';
import { resolveTokenSourcesDir } from '../../token_sources/file_utils';
import { resolveWorkflowsDir } from '../../workflows/file_utils';

export type DomainDirResolver = (orgSlug: string) => string;

/** `ConfigDomain.name` → absolute on-disk domain dir for an org. */
export const DOMAIN_DIR_RESOLVERS: Record<string, DomainDirResolver> = {
  agents: resolveAgentsDir,
  prompts: resolvePromptsDir,
  providers: resolveProvidersDir,
  integrations: resolveIntegrationsDir,
  'token-sources': resolveTokenSourcesDir,
  skills: resolveSkillsDir,
  branding: resolveBrandingDir,
  governance: resolveGovernanceDir,
  // `sso` is nested under governance — `resolveSsoDir` returns `<org>/governance/sso/`.
  sso: resolveSsoDir,
  automations: resolveAutomationsDir,
  // LEGACY-CHAIN ONLY: `workflows` left the config-domain registry when
  // standalone workflows retired (a workflow lives inline in its automation).
  // The resolver stays because pre-cutover v0_3_4 migrations (06, 30, and the
  // 33-cutover itself) still address org trees that carry a `workflows/` dir
  // mid-upgrade. Never reachable from live domain enumeration — the registry
  // (Layer A) no longer lists the name.
  workflows: resolveWorkflowsDir,
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
