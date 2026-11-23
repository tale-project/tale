/**
 * Where a sandbox session reaches the model relay (tale-project/tale#4942):
 * the backend's relay listener, over the sandbox network, at the address the
 * backend answers there. It replaced the sandbox LLM gateway, and keeps the
 * gateway's setting: `EXTERNAL_AGENT_GATEWAY_URL` names another address.
 *
 * A session's harness calls its models there, a device's hub relays the
 * logical name `gateway` there, and a video job's yt-dlp reaches its proxy
 * and PO-token relays there.
 */
const DEFAULT_MODEL_RELAY_URL = 'http://backend-api:8080';

/** The model relay as a session reaches it, without a trailing slash. */
export function modelRelayUrlForSessions(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const configured = env.EXTERNAL_AGENT_GATEWAY_URL?.trim();
  return (
    configured !== undefined && configured !== ''
      ? configured
      : DEFAULT_MODEL_RELAY_URL
  ).replace(/\/+$/, '');
}
