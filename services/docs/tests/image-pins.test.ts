import fs from 'node:fs';
import path from 'node:path';

import { describe, it } from 'vitest';

import { assertNoFindings, type Finding } from './lib/findings';
import { CONTENT_ROOT } from './lib/paths';
import { walkDocs } from './lib/walk';

/**
 * No page hard-codes a release number onto a `tale-*` image.
 *
 * A literal tag in an example is wrong within days of being written: it is
 * either behind the current release, or — as happened once — ahead of what is
 * actually published, so the page's own `docker compose up` cannot pull. The
 * examples therefore substitute one `${VERSION}` variable, which is also the
 * shape operators should copy: one number pins all seven images, so a stack
 * cannot end up with a new api beside an old proxy.
 *
 * Deliberately narrow — three things this must NOT flag:
 *
 *  - **Third-party images.** `quay.io/minio/minio:RELEASE.…` and
 *    `brainicism/bgutil-ytdlp-pot-provider:1.3.1` version independently of a
 *    Tale release and stay pinned by hand.
 *  - **`:latest` on a tale image.** The environment reference states the
 *    spawner's built-in default (`tale-sandbox-runtime:latest`) as a fact
 *    about the software; banning the string would forbid a true sentence.
 *  - **Prose about a release.** "upgraded from before 0.5.11" is a version
 *    boundary, not an image pin, so the match is anchored to the registry
 *    path.
 */
const PINNED_TALE_IMAGE =
  /ghcr\.io\/tale-project\/tale\/[a-z0-9-]+:\d+\.\d+\.\d+/;

describe('image pins', () => {
  it('no page hard-codes a release tag on a tale image', () => {
    const findings: Finding[] = [];
    for (const rel of walkDocs()) {
      const raw = fs
        .readFileSync(path.join(CONTENT_ROOT, rel), 'utf8')
        .replaceAll('\r\n', '\n');
      raw.split('\n').forEach((line, index) => {
        const match = PINNED_TALE_IMAGE.exec(line);
        if (match) {
          findings.push({
            file: rel,
            line: index + 1,
            rule: 'image-pin-hard-coded',
            detail: `\`${match[0]}\` hard-codes a release — substitute the tag (\`:\${VERSION}\`) and pin it once in the page's .env example`,
          });
        }
      });
    }
    assertNoFindings(findings, 'Hard-coded image pins');
  });
});
