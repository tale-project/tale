import path from 'node:path';

import { describe, it } from 'vitest';

import { assertNoFindings, type Finding } from './lib/findings';
import { walkDocs } from './lib/walk';

/**
 * Filenames in `docs/` map to URL slugs verbatim. The docs skill mechanics
 * section requires dash-case lowercase:
 *
 *   - `api-reference.md`   ✔
 *   - `api_reference.md`   ✗ (underscore reads as a typo in the URL)
 *   - `APIReference.md`    ✗ (camelCase reads ugly in the URL)
 *
 * The locale segment (`en`, `de-CH`) is exempted from the lowercase rule
 * because `de-CH` legitimately carries a capital region subtag.
 */

const SEGMENT_OK = /^[a-z0-9][a-z0-9-]*(?:\.mdx?)?$/;

describe('filenames', () => {
  it('every doc path is dash-case lowercase', () => {
    const findings: Finding[] = [];
    for (const rel of walkDocs()) {
      // Drop the locale segment — locale codes are exempt (de-CH carries an
      // uppercase region by design).
      const segments = rel.split(path.sep);
      for (let i = 1; i < segments.length; i++) {
        const seg = segments[i];
        if (!SEGMENT_OK.test(seg)) {
          findings.push({
            file: rel,
            line: 0,
            rule: 'filename-not-dash-case',
            detail: `segment "${seg}" is not dash-case lowercase`,
          });
        }
      }
    }
    assertNoFindings(findings, 'Filename issues');
  });
});
