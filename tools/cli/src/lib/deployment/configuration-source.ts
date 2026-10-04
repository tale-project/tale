import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';

import { parseDocument } from 'yaml';
import { z } from 'zod';

import { preconditionError } from '../../utils/fail';
import { parsePlatformConfiguration } from '../config/platform-model';
import { relativePath } from '../config/releases/model';

const fileReference = z.strictObject({ file: relativePath });
const MAX_FILE_BYTES = 512 * 1024;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;

/** Authoring-only indirection. Preparation captures ordinary expanded native
 * configuration in the immutable bundle; host apply never follows a path or
 * fetches a mutable policy file. There is no templating or environment reader. */
export async function resolveConfigurationSource(
  input: unknown,
  specPath: string,
): Promise<unknown> {
  const envelope = z
    .object({ configurationSource: relativePath.optional() })
    .passthrough()
    .parse(input);
  if (envelope.configurationSource === undefined) return input;
  if (Object.hasOwn(envelope, 'configuration'))
    throw preconditionError(
      'Select configuration or configurationSource, never both.',
    );
  if (extname(envelope.configurationSource) !== '.json')
    throw preconditionError(
      'Configuration source must be a relative JSON file.',
    );
  let total = 0;
  let files = 0;
  async function readOwned(base: string, path: string): Promise<string> {
    relativePath.parse(path);
    let candidate = resolve(base);
    const root = await realpath(candidate);
    if (root !== candidate || !(await lstat(candidate)).isDirectory())
      throw preconditionError(
        'Configuration source directory must not be a symlink.',
      );
    const parts = path.split('/');
    for (const [index, part] of parts.entries()) {
      candidate = join(candidate, part);
      const stat = await lstat(candidate);
      if (
        stat.isSymbolicLink() ||
        (index < parts.length - 1 ? !stat.isDirectory() : !stat.isFile())
      )
        throw preconditionError(
          'Configuration references must name regular files without symlinks.',
        );
      if (index === parts.length - 1 && stat.size > MAX_FILE_BYTES)
        throw preconditionError(
          'Configuration source file exceeds its byte limit.',
        );
    }
    if (++files > 128)
      throw preconditionError(
        'Configuration source has too many file references.',
      );
    const handle = await open(
      candidate,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES)
        throw preconditionError(
          'Configuration source is not a bounded regular file.',
        );
      // Bound the actual read as well as the initial stat: a concurrent append
      // cannot turn preparation into an unbounded allocation.
      const bytes = Buffer.alloc(MAX_FILE_BYTES + 1);
      let bytesRead = 0;
      while (bytesRead < bytes.length) {
        const chunk = await handle.read(
          bytes,
          bytesRead,
          bytes.length - bytesRead,
          bytesRead,
        );
        if (chunk.bytesRead === 0) break;
        bytesRead += chunk.bytesRead;
      }
      const after = await handle.stat();
      const named = await lstat(candidate);
      total += bytesRead;
      if (
        bytesRead > MAX_FILE_BYTES ||
        total > MAX_TOTAL_BYTES ||
        bytesRead !== stat.size ||
        after.size !== stat.size ||
        after.mtimeMs !== stat.mtimeMs ||
        after.ctimeMs !== stat.ctimeMs ||
        named.isSymbolicLink() ||
        named.dev !== stat.dev ||
        named.ino !== stat.ino ||
        (await realpath(candidate)) !== candidate
      )
        throw preconditionError(
          'Configuration source changed or exceeded its byte limit.',
        );
      return new TextDecoder('utf-8', { fatal: true }).decode(
        bytes.subarray(0, bytesRead),
      );
    } finally {
      await handle.close();
    }
  }
  const sourcePath = resolve(dirname(specPath), envelope.configurationSource);
  const raw: unknown = JSON.parse(
    await readOwned(dirname(resolve(specPath)), envelope.configurationSource),
  );
  const declaration = z
    .strictObject({
      schemaVersion: z.literal(1),
      resources: z
        .array(
          z
            .object({
              kind: z.string(),
              config: z.record(z.string(), z.unknown()),
            })
            .passthrough(),
        )
        .min(1)
        .max(128),
    })
    .parse(raw);
  for (const resource of declaration.resources) {
    const textKey =
      resource.kind === 'project-instructions' ||
      resource.kind === 'agent-instructions'
        ? 'instructions'
        : resource.kind === 'task-instructions'
          ? 'description'
          : undefined;
    if (textKey && typeof resource.config[textKey] !== 'string') {
      const reference = fileReference.parse(resource.config[textKey]);
      if (extname(reference.file) !== '.md')
        throw preconditionError(
          'Instruction references must be Markdown files.',
        );
      resource.config[textKey] = await readOwned(
        dirname(sourcePath),
        reference.file,
      );
    }
    if (
      resource.kind === 'automation-definition' &&
      fileReference.safeParse(resource.config.document).success
    ) {
      const reference = fileReference.parse(resource.config.document);
      if (!['.yaml', '.yml'].includes(extname(reference.file)))
        throw preconditionError(
          'Automation document references must be YAML files.',
        );
      const document = parseDocument(
        await readOwned(dirname(sourcePath), reference.file),
        { uniqueKeys: true },
      );
      if (document.errors.length)
        throw preconditionError('Configuration workflow YAML is invalid.');
      resource.config.document = document.toJS({ maxAliasCount: 50 });
    }
  }
  const configuration = parsePlatformConfiguration(declaration);
  const { configurationSource: _source, ...spec } = envelope;
  return { ...spec, configuration };
}
