import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { deploymentSpecSchema } from '../deployment/model';
import { parsePlatformConfiguration } from './platform-model';

/** Published operator examples are executable declarations, including files
 * checked out with Windows line endings. No target credentials are needed. */
describe('documented general platform configuration', () => {
  for (const locale of ['en', 'de', 'fr']) {
    for (const newline of ['\n', '\r\n']) {
      test(`${locale} JSON examples with ${JSON.stringify(newline)}`, () => {
        const file = new URL(
          `../../../../../docs/${locale}/self-hosted/install/cli-install.md`,
          import.meta.url,
        );
        const source = readFileSync(file, 'utf8').replace(/\r?\n/g, newline);
        const examples = [
          ...source.matchAll(/```json[^\r\n]*\r?\n([\s\S]*?)\r?\n```/g),
        ].map((match) => JSON.parse(match[1]));
        const ordinary = examples.find((example) => example.resources);
        const managed = examples.find((example) => example.configuration);
        expect(parsePlatformConfiguration(ordinary).resources).toHaveLength(2);
        const spec = deploymentSpecSchema.parse({
          schemaVersion: 1,
          name: 'example',
          stateDirectory: resolve(tmpdir(), 'tale-example'),
          composeProject: 'tale',
          runtime: { revision: 'a'.repeat(40) },
          origin: 'https://native.example.invalid',
          tlsMode: 'external',
          identity: {
            email: 'operator@example.invalid',
            slug: 'example',
            name: 'Example',
            ssoEnabled: false,
          },
          ...managed,
        });
        expect(
          spec.configuration?.resources.map((resource) => resource.kind),
        ).toEqual(['provider', 'provider-credential']);
      });
    }
  }
});
