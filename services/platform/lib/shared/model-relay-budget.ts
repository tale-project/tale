/**
 * How long a call through the model relay may go quiet
 * (tale-project/tale#4942). The relay replaced the sandbox LLM gateway and
 * keeps the gateway's setting: `SANDBOX_LLM_GATEWAY_STREAM_IDLE_TIMEOUT_SECONDS`
 * (read under its pre-rename name `LLM_GATEWAY_STREAM_IDLE_TIMEOUT_SECONDS`
 * too) names the idle budget.
 *
 * One budget, two readers: the relay waits that long between two chunks of a
 * stream, and a managed harness turn tells its CLI the same, so a CLI with an
 * idle watchdog of its own (Claude Code gives up after 300 s) never abandons
 * a quiet call the relay is still waiting on, and never sends it again.
 */

/** The idle budget when none is set, and the floor of the request timeout. */
const DEFAULT_STREAM_IDLE_SECONDS = 600;

/** The idle budget between two chunks of a stream, in seconds. A value that
 * is not a positive number reads as unset. */
export function streamIdleSeconds(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = (
    env.SANDBOX_LLM_GATEWAY_STREAM_IDLE_TIMEOUT_SECONDS ??
    env.LLM_GATEWAY_STREAM_IDLE_TIMEOUT_SECONDS
  )?.trim();
  const seconds = raw === undefined || raw === '' ? Number.NaN : Number(raw);
  return Number.isFinite(seconds) && seconds > 0
    ? seconds
    : DEFAULT_STREAM_IDLE_SECONDS;
}

/** How long a whole answer may take, in seconds: the idle budget, never
 * below 600 s. A harness falls back to a request that is not streamed when
 * a stream breaks, and that request carries the whole prefill, so a raised
 * idle budget raises this wait too. */
export function requestTimeoutSeconds(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return Math.max(DEFAULT_STREAM_IDLE_SECONDS, streamIdleSeconds(env));
}
