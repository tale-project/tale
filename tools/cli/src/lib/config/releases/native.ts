import { parse } from 'yaml';

import { parseAutomationPackZip } from '../../../../../../services/platform/backend/core/automations/pack_zip';
import { parseSkillBundleZip } from '../../../../../../services/platform/backend/core/skills/bundle_zip';
import { automationPackManifestSchema } from '../../../../../../services/platform/lib/automations/packs';
import { registerConnector } from '../../../../../../services/platform/lib/connectors/registry';
import { setCodeRunner } from '../../../../../../services/platform/lib/engine/core/runner';
import { validate } from '../../../../../../services/platform/lib/engine/core/validate';
import { createSandboxExecRunner } from '../../../../../../services/platform/lib/engine/runners/sandbox-exec';
import { connectorSchema } from '../../../../../../services/platform/lib/shared/schemas/connectors';
import { EMBEDDED_CONNECTORS } from '../../../generated/embedded-files';
import { assertNativeManifest } from './compiler';
import { sha256, stableJson } from './identity';
import { insist, record, type LoadedRelease } from './model';

/** Native parsing and compile-only syntax checks share the platform's code.
 * No client code executes and no connector dispatch, agent, or remote store is
 * installed. Embedding the catalogue makes the compiled CLI self-contained. */
export async function validateNativeRelease(
  release: LoadedRelease,
): Promise<void> {
  // Bun defers vm.Script parsing, so the native sandbox runner supplies its
  // portable Function/AsyncFunction compile-only checks. The transport refuses
  // every invocation: validation must never execute authored client code.
  setCodeRunner(
    createSandboxExecRunner(async () => {
      throw new Error('configuration validation cannot execute code');
    }),
  );
  insist(
    Object.keys(EMBEDDED_CONNECTORS).length > 0,
    'native connector catalogue missing',
  );
  for (const [name, text] of Object.entries(EMBEDDED_CONNECTORS)) {
    const connector = connectorSchema.parse(parse(text));
    insist(
      name === `connectors/${connector.name}/connector.yml`,
      'embedded connector identity differs',
    );
    registerConnector(connector);
  }
  const pack = await parseAutomationPackZip(release.bytes);
  insist(pack.manifest, 'native automation manifest missing');
  const raw: unknown = parse(pack.manifest.text);
  insist(record(raw), 'native automation manifest must be an object');
  assertNativeManifest(raw, automationPackManifestSchema.parse(raw));
  const checked = await validate(parse(pack.document.text));
  // Report stable issue codes and paths, never authored source or expressions.
  const issues = [...checked.errors, ...checked.warnings];
  insist(
    issues.length === 0,
    `native workflow validation failed: ${issues.map((issue) => issue.code).join(', ')}`,
  );
  const actual = pack.skills.flatMap((skill) =>
    skill.files.map((file) => ({
      slug: skill.slug,
      path: file.path,
      bytes: file.content.length,
      sha256: sha256(file.content),
    })),
  );
  const sorted = (files: typeof actual) =>
    [...files].sort((a, b) =>
      `${a.slug}/${a.path}` < `${b.slug}/${b.path}` ? -1 : 1,
    );
  insist(
    stableJson(sorted(actual)) ===
      stableJson(sorted(release.manifest.skillFiles)),
    'native parser asset inventory differs',
  );
  if (release.installation) {
    const workflow = await parseAutomationPackZip(
      release.installation.workflow.bytes,
    );
    insist(
      workflow.skills.length === 0 &&
        workflow.document.text === pack.document.text,
      'native workflow transport projection differs',
    );
    for (const skill of release.installation.skills) {
      const parsed = await parseSkillBundleZip(skill.bytes);
      insist(
        parsed.slug === skill.slug &&
          parsed.meta.owner === release.manifest.skillOwnerUserId,
        'native skill transport identity differs',
      );
    }
  }
}
