import { isRecord } from '../../../lib/utils/type-utils.ts';

/** The parts of an authoring refusal a reader takes as structure, not as a
 * sentence: the problems a document has, the hint, and the report of the
 * tests that failed. */
const REFUSAL_DETAIL_KEYS = ['errors', 'warnings', 'hint', 'report'] as const;

/**
 * The structure of a refusal the engine's authoring calls (`dispatch`)
 * answer as data — what the app door and the REST door both nest under
 * `data`, where a client that carries only `data` beside the code and the
 * sentence still finds every problem and where it is: the refusal's own
 * `data` (a refused run input's schema problems, say) with the detail keys
 * joined to it. Nothing when the refusal carries none.
 */
export function refusalDataOf(
  result: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const data: Record<string, unknown> = isRecord(result.data)
    ? { ...result.data }
    : {};
  for (const key of REFUSAL_DETAIL_KEYS) {
    if (result[key] !== undefined) data[key] = result[key];
  }
  return Object.keys(data).length > 0 ? data : undefined;
}
