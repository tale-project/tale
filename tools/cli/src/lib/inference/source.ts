import { z } from 'zod';

import { preconditionError } from '../../utils/fail';
import { git } from '../config/releases/git';
import { sha256, valueHash } from '../config/releases/identity';
import {
  gitSha,
  relativePath,
  repository,
  sha,
} from '../config/releases/model';
import { resolveInferenceSpec, type InferenceSpec } from './model';

export const inferenceSourceSchema = z.strictObject({
  repository,
  revision: gitSha,
  specPath: relativePath,
  sha256: sha,
  content: z.string().max(1_048_576),
});
export type InferenceSource = z.infer<typeof inferenceSourceSchema>;

export function committedInferenceSource(
  repoRoot: string,
  sourceRepository: string,
  revision: string,
  specPath: string,
): InferenceSource {
  const commit = gitSha.parse(revision);
  const file = relativePath.parse(specPath);
  const bytes = git(repoRoot, 'show', `${commit}:${file}`);
  const content = bytes.toString('utf8');
  if (bytes.length > 1_048_576 || !Buffer.from(content).equals(bytes))
    throw preconditionError(
      'Committed inference source must be bounded UTF-8 metadata.',
    );
  return inferenceSourceSchema.parse({
    repository: sourceRepository,
    revision: commit,
    specPath: file,
    sha256: sha256(bytes),
    content,
  });
}

/** Only explicitly declared public address variables may differ from source.
 * Freeze their resolved values without keeping the preparer's environment. */
export function verifyInferenceSource(
  source: InferenceSource,
  resolved: InferenceSpec,
) {
  if (sha256(source.content) !== source.sha256)
    throw preconditionError(
      'Inference source bytes differ from their committed hash.',
    );
  let input: unknown;
  try {
    input = JSON.parse(source.content);
  } catch {
    throw preconditionError('Committed inference source is not valid JSON.');
  }
  const nodes = z
    .object({
      nodes: z.array(
        z.object({
          key: z.string(),
          address: z.union([z.string(), z.object({ env: z.string() })]),
        }),
      ),
    })
    .parse(input).nodes;
  const publicEnvironment = Object.fromEntries(
    nodes.flatMap((node) =>
      typeof node.address === 'string'
        ? []
        : [
            [
              node.address.env,
              resolved.nodes.find((entry) => entry.key === node.key)?.address,
            ],
          ],
    ),
  );
  if (
    valueHash(resolveInferenceSpec(input, publicEnvironment)) !==
    valueHash(resolved)
  )
    throw preconditionError(
      'Resolved inference settings differ from committed client source.',
    );
}
