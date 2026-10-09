import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * The door a write came through, carried with the request instead of
 * threaded through every writer it reaches.
 *
 * A coding agent's tool call runs a writer deep inside a domain (a run
 * cancelled, a version saved) that knows nothing of MCP. The MCP door runs
 * each call inside a channel, and `createAuditLog` reads it: every audit row
 * written during the call says `via: 'mcp'`, the tool, the API key and the
 * client that asked, without any writer passing them along. The REST door
 * opens one around the automation definition writes it shares with MCP
 * (`via: 'api-key'`, the value its other writers stamp themselves), so a
 * delete made with a key names the key, not a click in the app. A writer
 * that names its own `via` (the skills publish door's `app` / `upload` /
 * `api`) keeps it.
 *
 * Its own store, separate from every other request-scoped store. Work a
 * call only schedules (a queued job, a durable run's next step) runs in a
 * worker of its own, outside the channel: its audit rows name the job, not
 * the agent that caused it.
 */
export interface RequestChannel {
  /** The door: a coding agent's MCP call, or a request to the REST API
   * made with a personal API key. */
  readonly via: 'mcp' | 'api-key';
  /** The HTTP request the call arrived in — what the caller can quote.
   * Absent where the door stamped none (a test). */
  readonly requestId?: string;
  /** The tool that was called. */
  readonly tool?: string;
  /** The API key the caller authenticated with. */
  readonly apiKeyId?: string;
  /** The name the caller's client gave itself, through `displayClientName`. */
  readonly clientName?: string;
}

const channels = new AsyncLocalStorage<RequestChannel>();

/** Run `fn` with `channel` as the current channel. */
export function runInRequestChannel<T>(
  channel: RequestChannel,
  fn: () => Promise<T>,
): Promise<T> {
  return channels.run(channel, fn);
}

/** The channel of the call this code runs in, if any. */
export function currentRequestChannel(): RequestChannel | undefined {
  return channels.getStore();
}

/**
 * What an audit row written inside the channel adds to its `metadata`: the
 * door and what the caller used, never an argument of the call. Absent
 * fields stay absent.
 */
export function channelAuditMetadata(
  channel: RequestChannel,
): Record<string, string> {
  return {
    via: channel.via,
    ...(channel.tool === undefined ? {} : { tool: channel.tool }),
    ...(channel.apiKeyId === undefined ? {} : { apiKeyId: channel.apiKeyId }),
    ...(channel.clientName === undefined
      ? {}
      : { clientName: channel.clientName }),
  };
}
