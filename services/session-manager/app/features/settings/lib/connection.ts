/** The MCP endpoint of the app, on the origin the page is served from. */
const MCP_PATH = '/mcp';

/** The name an assistant lists the server under. */
const SERVER_NAME = 'session-manager';

export function mcpEndpoint(origin: string): string {
  return `${origin.replace(/\/+$/, '')}${MCP_PATH}`;
}

/** Claude Code adds a server with one command. */
export function claudeCodeCommand(url: string): string {
  return `claude mcp add --transport http ${SERVER_NAME} ${url}`;
}

/** The `mcp.json` entry of Cursor, Windsurf and most other assistants. */
export function mcpJsonConfig(url: string): string {
  return JSON.stringify({ mcpServers: { [SERVER_NAME]: { url } } }, null, 2);
}

/**
 * Claude Desktop only starts servers as programs, so it reaches this one
 * through `mcp-remote`, which refuses a plain `http` address unless told
 * otherwise: the app is served on `http://127.0.0.1`.
 */
export function claudeDesktopConfig(url: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        [SERVER_NAME]: {
          command: 'npx',
          args: ['-y', 'mcp-remote', url, '--allow-http'],
        },
      },
    },
    null,
    2,
  );
}
