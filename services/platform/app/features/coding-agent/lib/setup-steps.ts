/**
 * The commands that connect a coding agent to Tale's MCP endpoint by browser
 * sign-in. Pure: a command is built from the endpoint's address and nothing
 * else, so there is no field a key or a token could reach one through.
 *
 * Only a client that was run against a live Tale gets commands here. Claude
 * Code 2.1.296 and the Codex CLI each signed in end to end (the consent page,
 * the redirect to the agent's own address, a list of tools answered). Every
 * other client gets the address and the guide until it has been tried the
 * same way.
 */

export const SETUP_CLIENTS = ['claude-code', 'codex', 'other'] as const;
export type SetupClient = (typeof SETUP_CLIENTS)[number];

/** The name Tale takes in an agent's own list of MCP servers. */
export const MCP_SERVER_NAME = 'tale';

/** Which sentence of the dialog belongs to a step; the component words it,
 * in the language the person reads. */
export type StepText =
  | 'claudeCodeAdd'
  | 'claudeCodeSignIn'
  | 'codexAdd'
  | 'codexSignIn'
  | 'otherAddress'
  | 'otherSignIn';

export interface SetupStep {
  readonly text: StepText;
  /** What to copy: a command to run, or an address. */
  readonly code?: string;
}

/** An address a command can carry without quoting: the characters of a host,
 * a port and a path, and none a shell reads as syntax. */
const COMMAND_SAFE_ADDRESS =
  /^https?:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?(?:\/[A-Za-z0-9._~%/-]*)?$/;

/**
 * The steps of one client, or `null` when the address could not be pasted
 * into a terminal as it is. The caller then offers the address alone.
 */
export function setupSteps(
  client: SetupClient,
  address: string,
): SetupStep[] | null {
  if (!COMMAND_SAFE_ADDRESS.test(address)) return null;
  if (client === 'claude-code') {
    return [
      {
        text: 'claudeCodeAdd',
        code: `claude mcp add --transport http ${MCP_SERVER_NAME} ${address}`,
      },
      { text: 'claudeCodeSignIn', code: `claude mcp login ${MCP_SERVER_NAME}` },
    ];
  }
  if (client === 'codex') {
    return [
      {
        text: 'codexAdd',
        code: `codex mcp add ${MCP_SERVER_NAME} --url ${address}`,
      },
      { text: 'codexSignIn', code: `codex mcp login ${MCP_SERVER_NAME}` },
    ];
  }
  return [{ text: 'otherAddress', code: address }, { text: 'otherSignIn' }];
}
