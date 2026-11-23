/**
 * Retire the sandbox LLM gateway an earlier release ran
 * (tale-project/tale#4942).
 *
 * The model relay in the backend serves every new agent turn and every call
 * of an API key, but a key the gateway minted before still settles through
 * it: the backend reads that key's spend there and revokes it. So a deploy
 * takes the container away only once the backend says no such key is open,
 * and asks where the always-roll tier converges, on every deploy that rolls
 * it, until the container is gone:
 *
 *  - none open: the container is removed and its volume kept;
 *  - some open: the container is left as it is, neither recreated nor
 *    updated, and a later deploy asks again;
 *  - the backend cannot say: the container is left as it is too, and the
 *    reason is said. A backend from before the relay has no such door, and
 *    that is the backend a deploy asks on the first deploy of this release:
 *    the live colour is still the old one when the always-roll tier rolls.
 *
 * Never the volume: it holds the keys of the providers the gateway reached
 * and the spend of the keys it minted, a snapshot taken while the gateway ran
 * restores into it, and its operator removes it once nothing needs it.
 *
 * Once the container is gone, every colour a deploy or a rollback starts
 * tells its backend roles that the gateway is retired ({@link
 * gatewayRetired}), so that the backend never has to guess it from a lookup
 * of the gone name: a host whose resolver cannot answer at all reports that
 * lookup as unfinished, not as a name that does not exist. While it is
 * there, they need its admin password, which a deploy keeps in `.env`
 * ({@link keepGatewayPassword}).
 */

import { z } from 'zod';

import { getProjectId } from '../../utils/load-env';
import * as logger from '../../utils/logger';
import { GATEWAY_VOLUME } from '../backup/constants';
import { readEnvVars, setEnvVars } from '../config/ensure-env';
import { containerEnvValue } from '../docker/container-env';
import { controlCall, DEFAULT_CONTROL_TIMEOUT_S } from '../docker/control-call';
import type { StackRuntime } from '../runtime/types';

/** The service the gateway ran as; its container is `<project>-<service>`. */
const GATEWAY_SERVICE = 'sandbox-llm-gateway';

/** The names the gateway's container answered to on the stack's networks:
 * its service and the alias it kept from before its rename. */
const GATEWAY_HOSTS: ReadonlySet<string> = new Set([
  GATEWAY_SERVICE,
  'llm-gateway',
]);

/**
 * Whether the gateway an earlier release ran is retired here: its container
 * is gone, and `.env` names no gateway at an address of its own, which no
 * deploy ever ran or retires. Each backend role of a colour started now is
 * told so (`ServiceConfig.gatewayRetired`).
 */
export async function gatewayRetired(runtime: StackRuntime): Promise<boolean> {
  if (await runtime.exists(`${getProjectId()}-${GATEWAY_SERVICE}`))
    return false;
  const configured = (
    process.env.SANDBOX_LLM_GATEWAY_URL ?? process.env.LLM_GATEWAY_URL
  )?.trim();
  if (configured === undefined || configured === '') return true;
  return (
    URL.canParse(configured) && GATEWAY_HOSTS.has(new URL(configured).hostname)
  );
}

/** The gateway's admin password, by its name and the name it had before the
 * rename, which the backend still reads. */
const PASSWORD_KEY = 'SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD';
const PASSWORD_KEYS = [PASSWORD_KEY, 'LLM_GATEWAY_ADMIN_PASSWORD'] as const;

/** Whether `.env` gives the password a value: blank, or quotes around
 * nothing, is none, as the backend reads it. */
function holdsPassword(values: Record<string, string>): boolean {
  return PASSWORD_KEYS.some(
    (key) => (values[key] ?? '').replace(/^["']|["']$/g, '').trim() !== '',
  );
}

/** What a deploy did about the gateway's admin password. */
export type GatewayPassword =
  | { outcome: 'absent' }
  | { outcome: 'no-env' }
  | { outcome: 'kept' }
  | { outcome: 'restored' }
  | { outcome: 'missing' };

/**
 * Keep the gateway's admin password in `.env` while the gateway's container
 * is there. With it, the backend reads the spend of the keys the gateway
 * minted and revokes them; without it, those keys never settle, and no
 * deploy retires the gateway. A backend role reads `.env` when its container
 * is created, so a password taken out of `.env` reaches the colour the next
 * deploy starts.
 *
 * Where `.env` gives it no value, the gateway's own environment still holds
 * it: the gateway was created from the same `.env`. It is written back under
 * its name, and said so, never printed. Where the gateway holds none either,
 * the deploy says what is missing and how to recover.
 */
export async function keepGatewayPassword(options: {
  runtime: StackRuntime;
  deployDir: string;
  /** The gateway's own value, read from its container (Docker by default). */
  readGatewayValue?: (
    container: string,
    keys: readonly string[],
  ) => Promise<string | null>;
}): Promise<GatewayPassword> {
  const { runtime, deployDir } = options;
  const container = `${getProjectId()}-${GATEWAY_SERVICE}`;
  if (!(await runtime.exists(container))) return { outcome: 'absent' };
  const values = await readEnvVars(deployDir);
  if (values === null) return { outcome: 'no-env' };
  if (holdsPassword(values)) return { outcome: 'kept' };

  const read = options.readGatewayValue ?? containerEnvValue;
  const password = (await read(container, PASSWORD_KEYS))?.trim();
  if (password === undefined || password === '') {
    logger.warn(
      `The model gateway ${container} is still there, but ${PASSWORD_KEY} is neither in .env nor in the gateway's own environment. Without it the backend can neither read the spend of the keys the gateway minted nor revoke them, so they never settle and no deploy retires the gateway. Set ${PASSWORD_KEY} in .env to the password the gateway was deployed with, then run \`tale deploy\` again. If it is lost, remove the gateway (docker rm -f ${container}): the next \`tale deploy\` tells the backend that it is retired, and the keys it minted close without their spend.`,
    );
    return { outcome: 'missing' };
  }
  await setEnvVars(deployDir, { [PASSWORD_KEY]: password });
  logger.info(
    `Put ${PASSWORD_KEY} back into .env from the model gateway ${container}, which is still there: the backend reads the spend of the keys the gateway minted and revokes them with it. Leave it in .env until a deploy retires the gateway.`,
  );
  return { outcome: 'restored' };
}

/** The control door that counts the keys the gateway minted which have not
 * settled yet: turns whose spend is unread or whose key is unrevoked, and
 * sessions that still hold one. */
export const GATEWAY_KEYS_PATH = '/api/control/gateway-keys';

const gatewayKeysSchema = z.object({ open: z.number().int().nonnegative() });

/** What a deploy did with the gateway, or would do in a dry run. */
export type GatewayRetirement =
  | { outcome: 'absent' }
  | { outcome: 'retired' }
  | { outcome: 'kept'; open: number }
  | { outcome: 'unanswered'; reason: string }
  | { outcome: 'not-removed' };

/** The number of open gateway keys, or why the backend could not say. */
async function openGatewayKeys(
  runtime: StackRuntime,
): Promise<{ open: number } | { reason: string }> {
  const answer = await controlCall('GET', GATEWAY_KEYS_PATH, { runtime });
  if (!answer.success) {
    if (answer.exitCode === 124)
      return {
        reason: `the backend did not answer within ${DEFAULT_CONTROL_TIMEOUT_S} s`,
      };
    const said = answer.stderr.trim().slice(0, 200);
    return {
      reason:
        said === ''
          ? `the call exited with code ${answer.exitCode ?? 'unknown'}`
          : said,
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(answer.stdout);
  } catch (error) {
    logger.debug(
      `The answer of ${GATEWAY_KEYS_PATH} is no JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { reason: 'its answer is no count of open keys' };
  }
  const count = gatewayKeysSchema.safeParse(parsed);
  return count.success
    ? { open: count.data.open }
    : { reason: 'its answer is no count of open keys' };
}

/**
 * Retire the gateway container of this project where the backend says no key
 * it minted is open; see the module comment. A dry run asks the backend too,
 * which changes nothing, and says what the deploy would do.
 */
export async function retireGateway(options: {
  dryRun: boolean;
  runtime: StackRuntime;
}): Promise<GatewayRetirement> {
  const { dryRun, runtime } = options;
  const prefix = dryRun ? '[DRY-RUN] ' : '';
  const container = `${getProjectId()}-${GATEWAY_SERVICE}`;
  if (!(await runtime.exists(container))) return { outcome: 'absent' };
  const volume = `${getProjectId()}_${GATEWAY_VOLUME}`;
  const keep = dryRun ? 'Would keep' : 'Kept';

  const keys = await openGatewayKeys(runtime);
  if ('reason' in keys) {
    logger.warn(
      `${prefix}${keep} the model gateway ${container} as it is: the backend could not say whether keys it minted are still open (${keys.reason}). A backend from before this release has no such answer, so the first deploy of this release keeps the gateway; a later \`tale deploy\` asks again.`,
    );
    return { outcome: 'unanswered', reason: keys.reason };
  }
  if (keys.open > 0) {
    const open =
      keys.open === 1
        ? '1 key it minted is still open'
        : `${keys.open} keys it minted are still open`;
    logger.info(
      `${prefix}${keep} the model gateway ${container} as it is: ${open}, held by turns that started before this release, sessions that still run, or an organization's deletion. A later \`tale deploy\` retires it once none is.`,
    );
    return { outcome: 'kept', open: keys.open };
  }

  if (dryRun) {
    logger.info(
      `${prefix}Would retire the model gateway ${container}: no key it minted is open. Its volume ${volume} would be kept.`,
    );
    return { outcome: 'retired' };
  }
  if (!(await runtime.remove(container))) {
    logger.warn(
      `Could not retire the model gateway ${container}, although no key it minted is open: remove the container by hand (docker rm -f ${container}). Its volume ${volume} stays either way.`,
    );
    return { outcome: 'not-removed' };
  }
  const removal = await runtime.volumeRemovalHint(volume);
  logger.info(
    `Retired the model gateway ${container}: no key it minted is open, and the model relay in the backend serves every turn.${
      removal === null
        ? ''
        : ` Its volume ${volume} is kept, with the keys of the providers it reached; a snapshot taken while the gateway ran restores into it. Once you no longer need it: ${removal}`
    }`,
  );
  return { outcome: 'retired' };
}
