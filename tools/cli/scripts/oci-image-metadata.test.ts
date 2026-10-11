import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Tale's images say what they are. A registry, a scanner and `docker inspect`
 * read the org.opencontainers.image.* labels of an image's config, and a base
 * image's own labels reach ours unless the final stage overrides them (the
 * released web image claimed Bun's URL and an unasserted license, the proxy
 * Caddy's URL and docs). This file keeps every image's metadata complete, and
 * each section runs the real file; none of them restates a value the build
 * decides.
 */

const repository = resolve(import.meta.dir, '../../..');
const OCI = 'org.opencontainers.image';

/**
 * What every Tale image says about itself, apart from its title, description
 * and version. `source` is exact: the CLI refuses an image whose source label
 * differs (tools/cli/src/lib/deployment/tag-automation-protocol.ts).
 */
const IDENTITY: Record<string, string> = {
  source: 'https://github.com/tale-project/tale',
  url: 'https://tale.dev',
  documentation: 'https://docs.tale.dev',
  vendor: 'Tale',
  licenses: 'MIT',
};
const DECLARED = [
  'title',
  'description',
  'version',
  ...Object.keys(IDENTITY),
] as const;

const services = readdirSync(join(repository, 'services'), {
  withFileTypes: true,
})
  .filter(
    (entry) =>
      entry.isDirectory() &&
      existsSync(join(repository, 'services', entry.name, 'Dockerfile')),
  )
  .map((entry) => entry.name)
  .toSorted();

interface Instruction {
  keyword: string;
  args: string;
}

/**
 * The instructions of a Dockerfile as BuildKit reads them: a trailing
 * backslash continues a line, and comment and blank lines are dropped.
 */
function instructionsOf(dockerfile: string): Instruction[] {
  const instructions: Instruction[] = [];
  let pending = '';
  for (const line of dockerfile.split(/\r?\n/)) {
    if (/^\s*(#|$)/.test(line)) continue;
    pending += line.replace(/\\\s*$/, '');
    if (/\\\s*$/.test(line)) continue;
    const match = /^\s*(\S+)\s*(.*)$/s.exec(pending);
    pending = '';
    if (match)
      instructions.push({ keyword: match[1]!.toUpperCase(), args: match[2]! });
  }
  return instructions;
}

/** What ships: everything from the last FROM on. */
function finalStage(dockerfile: string): Instruction[] {
  const instructions = instructionsOf(dockerfile);
  return instructions.slice(
    instructions.findLastIndex((entry) => entry.keyword === 'FROM'),
  );
}

/** The `key=value` pairs of the final stage's LABEL instructions. */
function labelsOf(stage: Instruction[]): { key: string; raw: string }[] {
  return stage
    .filter((entry) => entry.keyword === 'LABEL')
    .flatMap((entry) =>
      [...entry.args.matchAll(/([^\s=]+)=("(?:[^"\\]|\\.)*"|\S*)/g)].map(
        (match) => ({ key: match[1]!, raw: match[2]! }),
      ),
    );
}

/** Every way a Dockerfile's final stage falls short of the label contract. */
function problemsOf(service: string, dockerfile: string): string[] {
  const stage = finalStage(dockerfile);
  const labels = labelsOf(stage);
  const problems: string[] = [];
  const value = (key: string) => {
    const raw = labels.find((label) => label.key === `${OCI}.${key}`)?.raw;
    return raw?.replace(/^"(.*)"$/s, '$1');
  };
  for (const key of DECLARED)
    if (value(key) === undefined)
      problems.push(`${OCI}.${key} is not declared by the final stage`);
  for (const label of labels) {
    if (labels.filter((other) => other.key === label.key).length > 1)
      problems.push(`${label.key} is declared twice in the final stage`);
    // The release workflow reads these values back out of the Dockerfile, one
    // quoted `key="value"` each.
    if (label.key.startsWith(`${OCI}.`) && !/^"[^"\\]*"$/.test(label.raw))
      problems.push(`${label.key} must be one double-quoted value`);
  }
  // A value that is declared must also be the right one; one that is not has
  // been reported above.
  const expected: Record<string, string> = {
    ...IDENTITY,
    title: `tale-${service}`,
    version: '${VERSION}',
  };
  for (const [key, want] of Object.entries(expected))
    if (value(key) !== undefined && value(key) !== want)
      problems.push(`${OCI}.${key} must be ${want}, not ${value(key)}`);
  const description = value('description');
  if (description !== undefined && !/^[^\n"\\$]{10,160}$/.test(description))
    problems.push(`${OCI}.description must be 10 to 160 plain characters`);
  // ARG values do not survive a FROM: the stage declares VERSION itself, ahead
  // of the label that reads it.
  const argument = stage.findIndex(
    (entry) => entry.keyword === 'ARG' && /^VERSION(?:=|$)/.test(entry.args),
  );
  const version = stage.findIndex(
    (entry) =>
      entry.keyword === 'LABEL' && entry.args.includes(`${OCI}.version=`),
  );
  if (argument === -1 || (version !== -1 && argument > version))
    problems.push('the final stage must declare ARG VERSION before its label');
  return problems;
}

const dockerfile = (service: string) =>
  readFileSync(join(repository, `services/${service}/Dockerfile`), 'utf8');

describe('every image declares the OCI labels a registry and docker inspect read', () => {
  test('the guard sees every image the repository builds', () => {
    expect(services).toContain('platform');
    expect(services).toContain('sandbox-runtime');
    expect(services.length).toBeGreaterThanOrEqual(12);
  });

  test.each(services)(
    '%s: the final stage carries the whole set, with the fixed source',
    (service) => {
      expect(problemsOf(service, dockerfile(service))).toEqual([]);
    },
  );

  describe('the check itself', () => {
    const db = dockerfile('db');
    const without = (key: string) =>
      db
        .split('\n')
        .filter((line) => !line.includes(`${OCI}.${key}=`))
        .join('\n');

    test('accepts the real db image', () => {
      expect(problemsOf('db', db)).toEqual([]);
    });

    test.each(DECLARED.filter((key) => key !== 'version'))(
      'refuses a final stage without %s',
      (key) => {
        expect(problemsOf('db', without(key))).toContain(
          `${OCI}.${key} is not declared by the final stage`,
        );
      },
    );

    test('refuses another source, which the CLI would refuse at deploy time', () => {
      expect(
        problemsOf(
          'db',
          db.replace(IDENTITY.source!, 'https://github.com/example/fork'),
        ),
      ).toContain(
        `${OCI}.source must be ${IDENTITY.source}, not https://github.com/example/fork`,
      );
    });

    test('refuses a version label read before ARG VERSION is declared', () => {
      expect(
        problemsOf('db', db.replace(/^ARG VERSION=dev$/gm, '# no ARG')),
      ).toContain('the final stage must declare ARG VERSION before its label');
    });

    test('refuses labels left in a stage that does not ship (the platform image)', () => {
      const squash = [
        'FROM debian:bookworm-slim AS runner',
        'ARG VERSION=dev',
        `LABEL ${OCI}.version="\${VERSION}" \\`,
        `      ${OCI}.title="tale-platform" \\`,
        `      ${OCI}.description="Tale Platform — the stage that does not ship" \\`,
        `      ${OCI}.source="${IDENTITY.source}"`,
        'FROM scratch',
        'COPY --from=runner / /',
        'ARG VERSION=dev',
        `LABEL ${OCI}.version="\${VERSION}"`,
      ].join('\n');
      expect(problemsOf('platform', squash)).toEqual([
        `${OCI}.title is not declared by the final stage`,
        `${OCI}.description is not declared by the final stage`,
        `${OCI}.source is not declared by the final stage`,
        `${OCI}.url is not declared by the final stage`,
        `${OCI}.documentation is not declared by the final stage`,
        `${OCI}.vendor is not declared by the final stage`,
        `${OCI}.licenses is not declared by the final stage`,
      ]);
    });

    test('refuses an unquoted value and a label declared twice', () => {
      expect(
        problemsOf(
          'db',
          db.replace(
            'org.opencontainers.image.vendor="Tale"',
            `${OCI}.vendor=Tale`,
          ),
        ),
      ).toContain(`${OCI}.vendor must be one double-quoted value`);
      expect(problemsOf('db', `${db}\nLABEL ${OCI}.vendor="Tale"\n`)).toContain(
        `${OCI}.vendor is declared twice in the final stage`,
      );
    });
  });
});
