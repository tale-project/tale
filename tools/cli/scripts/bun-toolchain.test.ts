import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const read = (file: string) => readFileSync(join(root, file), 'utf8');
const version = JSON.parse(read('package.json')).packageManager.replace(
  'bun@',
  '',
);
const clients = ['platform', 'web', 'docs', 'ui-docs', 'ai-gateway'];
const helper = '../../packages/ui/bin/build-client.ts';

describe('one pinned Bun toolchain for CI, builds and runtimes', () => {
  test('every Docker consumer and generator pins the workspace version by digest', () => {
    const files = [
      'services/**/Dockerfile',
      'tools/plop/templates/**/Dockerfile.hbs',
    ].flatMap((pattern) =>
      Array.from(new Bun.Glob(pattern).scanSync({ cwd: root })),
    );
    const images = files.flatMap((file) =>
      [...read(file).matchAll(/^FROM\s+(oven\/bun:[^\s]+)\s/gm)].map(
        (match) => ({ file, image: match[1]! }),
      ),
    );
    expect(new Set(images.map(({ file }) => file)).size).toBe(8);
    const flavors = new Map<string, string>();
    for (const { file, image } of images) {
      const pin =
        /^oven\/bun:(\d+\.\d+\.\d+)(-slim|-debian)?@sha256:([a-f0-9]{64})$/.exec(
          image,
        );
      expect(pin, `${file}: ${image}`).not.toBeNull();
      if (!pin) continue;
      expect(pin[1], file).toBe(version);
      const flavor = pin[2] ?? '';
      const previous = flavors.get(flavor);
      if (previous !== undefined) expect(pin[3], file).toBe(previous);
      flavors.set(flavor, pin[3]!);
    }
    expect(read('.github/actions/setup-turbo/action.yml')).toContain(
      `default: '${version}'`,
    );
    expect(read('.github/actions/setup-cli/action.yml')).toContain(
      `bun-version: '${version}'`,
    );
  });

  test.each(clients)(
    '%s production clients use the awaited helper before downstream commands',
    (service) => {
      const scripts = JSON.parse(
        read(`services/${service}/package.json`),
      ).scripts;
      expect(scripts.build).toContain(`bun --bun ${helper}`);
      if (scripts['build:client'])
        expect(scripts['build:client']).toBe(`bun --bun ${helper}`);
      const dockerfile = read(`services/${service}/Dockerfile`);
      expect(dockerfile).toContain(`bun --bun ${helper}`);
      expect(dockerfile).toContain('COPY packages/ui ./packages/ui');
      expect(dockerfile).toContain(`WORKDIR /app/services/${service}`);
      expect(dockerfile).not.toMatch(
        /bun --bun vite build(?:\s*\\?\s*(?:&&|$))/m,
      );
      if (['web', 'docs', 'ui-docs'].includes(service)) {
        expect(dockerfile).toContain(
          'bun --bun vite build --ssr app/entry-server.tsx --outDir dist-ssr',
        );
      }
    },
  );

  test('new React services and local preview chains reuse the same helper', () => {
    for (const file of ['Dockerfile.hbs', 'package.json.hbs'])
      expect(read(`tools/plop/templates/service/react/${file}`)).toContain(
        `bun --bun ${helper}`,
      );
    for (const service of ['web', 'docs'])
      expect(read(`services/${service}/playwright.config.ts`)).toContain(
        `bun --bun ${helper}`,
      );
    expect(read('services/platform/scripts/dev-engine.ts')).toContain(
      `'${helper}'`,
    );
    expect(read('services/ui-docs/playwright.config.ts')).toContain(
      'vite --strictPort',
    );
  });
});
