/**
 * How a deployment lets coding agents sign in to the MCP endpoint, read
 * from its environment: whether an agent may identify itself by a client
 * metadata document it publishes (CIMD), from which hosts, whether an agent
 * may register itself (open dynamic client registration, restricted), and
 * to which web hosts a self-registered agent may send the person back.
 *
 * Read once where the authorization server is built (`auth.ts`) and where
 * its endpoints are mounted (`app.ts`); `backend/env.ts` refuses a
 * malformed value at boot.
 */

/** The web hosts an agent that registers itself may name as its redirect:
 * the hosted agents' own sign-in pages. Every other agent gets a local
 * (loopback) or app redirect. */
export const DEFAULT_DCR_WEB_REDIRECT_HOSTS = [
  'claude.ai',
  'claude.com',
  'chatgpt.com',
  'vscode.dev',
  'insiders.vscode.dev',
] as const;

export interface AgentOAuthOptions {
  /** Whether an agent may identify itself by an HTTPS client metadata
   * document (`TALE_MCP_CLIENT_METADATA_DOCUMENTS`, on by default). */
  readonly metadataDocuments: boolean;
  /** The hosts such a document may come from; empty: any public HTTPS host
   * (`TALE_MCP_CLIENT_METADATA_HOSTS`). */
  readonly metadataHosts: readonly string[];
  /** Whether an agent may register itself (`TALE_MCP_DYNAMIC_CLIENT_REGISTRATION`,
   * on by default). */
  readonly dynamicRegistration: boolean;
  /** The HTTPS redirect hosts a self-registered agent may name
   * (`TALE_MCP_DCR_WEB_REDIRECT_HOSTS`). */
  readonly webRedirectHosts: readonly string[];
}

/** A DNS host name: labels of letters, digits and inner hyphens. */
const HOST_NAME =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;

function entriesOf(value: string | undefined): string[] {
  return (value ?? '')
    .split(/[\s,]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry !== '');
}

/** The entries of a host list (comma- or space-separated) that are not host
 * names — a scheme, a path, a port or free text — empty when every entry is
 * one. */
export function invalidHostEntries(value: string | undefined): string[] {
  return entriesOf(value).filter((entry) => !HOST_NAME.test(entry));
}

/** A host list as compared: lower-cased, without blanks or repeats. */
function hostList(value: string | undefined): string[] {
  return [
    ...new Set(entriesOf(value).filter((entry) => HOST_NAME.test(entry))),
  ];
}

/** `true` unless the variable says `false`. */
function onUnlessFalse(value: string | undefined): boolean {
  return value?.trim().toLowerCase() !== 'false';
}

export function agentOAuthOptionsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): AgentOAuthOptions {
  const webRedirectHosts = env.TALE_MCP_DCR_WEB_REDIRECT_HOSTS;
  return {
    metadataDocuments: onUnlessFalse(env.TALE_MCP_CLIENT_METADATA_DOCUMENTS),
    metadataHosts: hostList(env.TALE_MCP_CLIENT_METADATA_HOSTS),
    dynamicRegistration: onUnlessFalse(
      env.TALE_MCP_DYNAMIC_CLIENT_REGISTRATION,
    ),
    webRedirectHosts:
      webRedirectHosts === undefined
        ? [...DEFAULT_DCR_WEB_REDIRECT_HOSTS]
        : hostList(webRedirectHosts),
  };
}
