import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';

import { PLATFORM_RESOURCES_MAX } from '@tale/shared/config/platform-resources';
import { parseDocument } from 'yaml';
import { z } from 'zod';

import { preconditionError } from '../../utils/fail';
import { parsePlatformConfiguration } from '../config/platform-model';
import { relativePath } from '../config/releases/model';
import { parseDeclarationText } from './declaration-text';

const fileReference = z.strictObject({ file: relativePath });
const MAX_FILE_BYTES = 512 * 1024;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;
/** The most distinct files one declaration reads, its included
 * declarations among them; a file named twice is read once. */
const MAX_FILES = 512;
const declarationExtensions = new Set(['.json', '.yaml', '.yml']);

/** One declaration file: its resources, and the declaration files it
 * includes, each relative to its own directory. */
const declarationFile = z.strictObject({
  schemaVersion: z.literal(1),
  include: z.array(relativePath).max(MAX_FILES).optional(),
  resources: z
    .array(
      z
        .object({
          kind: z.string(),
          config: z.record(z.string(), z.unknown()),
        })
        .passthrough(),
    )
    .max(PLATFORM_RESOURCES_MAX)
    .default([]),
});

/** Authoring-only indirection. Preparation captures ordinary expanded native
 * configuration in the immutable bundle; host apply never follows a path or
 * fetches a mutable policy file. A declaration may include other declaration
 * files, merged into one before it is validated. There is no templating or
 * environment reader. */
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
  if (!declarationExtensions.has(extname(envelope.configurationSource)))
    throw preconditionError(
      'Configuration source must be a relative JSON or YAML file.',
    );
  let total = 0;
  let files = 0;
  // Each distinct file is read once: a second reference to it shares the
  // first read's bytes and counts against no limit again.
  const reads = new Map<string, Promise<string>>();
  function readOwned(base: string, path: string): Promise<string> {
    relativePath.parse(path);
    const key = resolve(base, path);
    let read = reads.get(key);
    if (read === undefined) {
      read = readOwnedOnce(base, path);
      reads.set(key, read);
    }
    return read;
  }
  async function readOwnedOnce(base: string, path: string): Promise<string> {
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
    if (++files > MAX_FILES)
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
  type Resource = z.infer<typeof declarationFile>['resources'][number];
  const declarations = new Set<string>();
  /** A declaration file's resources with their file references read, then
   * those of the files it includes, in the order it lists them. */
  async function expand(base: string, path: string): Promise<Resource[]> {
    const sourcePath = resolve(base, path);
    if (declarations.has(sourcePath))
      throw preconditionError(
        `Configuration declaration ${path} is included more than once.`,
        'Include each declaration file once; its resources would otherwise be declared twice.',
      );
    declarations.add(sourcePath);
    const parsed = declarationFile.safeParse(
      parseDeclarationText(await readOwned(base, path), path),
    );
    if (!parsed.success)
      throw preconditionError(
        `Configuration declaration ${path} is not a declaration of schemaVersion 1 with resources and includes.`,
      );
    const directory = dirname(sourcePath);
    for (const resource of parsed.data.resources) {
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
        resource.config[textKey] = await readOwned(directory, reference.file);
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
          await readOwned(directory, reference.file),
          { uniqueKeys: true },
        );
        if (document.errors.length)
          throw preconditionError('Configuration workflow YAML is invalid.');
        resource.config.document = document.toJS({ maxAliasCount: 50 });
      }
    }
    const resources = [...parsed.data.resources];
    for (const included of parsed.data.include ?? []) {
      if (!declarationExtensions.has(extname(included)))
        throw preconditionError(
          'Included configuration declarations must be JSON or YAML files.',
        );
      resources.push(...(await expand(directory, included)));
      if (resources.length > PLATFORM_RESOURCES_MAX)
        throw preconditionError(
          `Configuration declares more than ${PLATFORM_RESOURCES_MAX} resources with its included files.`,
        );
    }
    return resources;
  }
  const declaration = {
    schemaVersion: 1,
    resources: await expand(
      dirname(resolve(specPath)),
      envelope.configurationSource,
    ),
  };
  const configuration = parsePlatformConfiguration(declaration);
  const { configurationSource: _source, ...spec } = envelope;
  return { ...spec, configuration };
}
