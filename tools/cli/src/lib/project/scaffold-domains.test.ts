import { describe, expect, test } from 'bun:test';

import { EMBEDDED_EXAMPLES } from '../../generated/embedded-files';
import { getEmbeddedExamples } from './fetch-reference';
import { ORG_DOMAIN_DIRS, SCAFFOLD_DOMAINS } from './org-dirs';

/** The domain prefixes the binary actually embeds (builtin-configs/<domain>/…). */
function embeddedDomains(): Set<string> {
  const domains = new Set<string>();
  for (const path of Object.keys(EMBEDDED_EXAMPLES)) {
    const match = /^builtin-configs\/([^/]+)\//.exec(path);
    if (match) domains.add(match[1]);
  }
  return domains;
}

describe('SCAFFOLD_DOMAINS', () => {
  test('scaffolds every catalog domain the binary embeds', () => {
    // A domain in the embedded catalog that init/update never write is a
    // dead end: generated, shipped, unreachable (automations + governance
    // were exactly that).
    const scaffolded: readonly string[] = SCAFFOLD_DOMAINS;
    for (const domain of embeddedDomains()) {
      expect(scaffolded).toContain(domain);
    }
  });

  test('never scaffolds a domain the binary has no files for', () => {
    // The retired workflows/connectors/providers prefixes produced empty
    // directories for domains the platform no longer ships here.
    for (const domain of SCAFFOLD_DOMAINS) {
      expect(getEmbeddedExamples(domain).size).toBeGreaterThan(0);
    }
  });

  test('every scaffolded domain is an org domain (dev compose bind-mounts it)', () => {
    const orgDomains: readonly string[] = ORG_DOMAIN_DIRS;
    for (const domain of SCAFFOLD_DOMAINS) {
      expect(orgDomains).toContain(domain);
    }
  });
});
