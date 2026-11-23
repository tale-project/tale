import { z } from 'zod';

import * as logger from '../../utils/logger';
import { docker } from './docker';

const inspected = z.array(
  z.object({ Config: z.object({ Env: z.array(z.string()).nullable() }) }),
);

/**
 * The value a container's environment gives the first of `keys` it sets, or
 * null where the container is gone or sets none of them.
 *
 * Only for the one secret the CLI carries back into `.env` (the retired
 * model gateway's admin password, actions/retire-gateway.ts): the caller
 * writes it there and never prints it. The inspect's answer holds the
 * container's whole environment, so nothing here logs it.
 */
export async function containerEnvValue(
  container: string,
  keys: readonly string[],
): Promise<string | null> {
  const result = await docker('container', 'inspect', container);
  if (!result.success) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (error) {
    logger.debug(
      `docker container inspect ${container} answered no JSON: ${error instanceof Error ? error.name : 'unknown error'}`,
    );
    return null;
  }
  const record = inspected.safeParse(parsed);
  if (!record.success) return null;
  const environment = record.data[0]?.Config.Env ?? [];
  for (const key of keys) {
    const entry = environment.find((line) => line.startsWith(`${key}=`));
    if (entry !== undefined) return entry.slice(key.length + 1);
  }
  return null;
}
