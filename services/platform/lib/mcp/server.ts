import { API_CONTRACT_VERSION } from '../shared/constants/api-contract';

/**
 * What the MCP endpoint says about itself, in one place: the protocol
 * revisions it speaks, what it can do, and who it is. The protocol layer
 * answers them; the contract fingerprint (`contract.ts`) covers them.
 */

/**
 * The protocol revisions this endpoint speaks, newest first. `initialize`
 * echoes a client's proposal when it is one of these and answers the newest
 * otherwise (the lifecycle's rule for a proposal the server lacks); a
 * request whose `MCP-Protocol-Version` header names another is refused with
 * this list. All three fit a JSON-only tools server: 2025-03-26 requires
 * receiving batches, which the transport does; 2025-06-18 added the header;
 * 2025-11-25 made argument errors tool errors and JSON Schema 2020-12 the
 * default dialect, both of which this server follows for every revision.
 */
export const MCP_PROTOCOL_VERSIONS: readonly string[] = [
  '2025-11-25',
  '2025-06-18',
  '2025-03-26',
];

/** What `initialize` says the server can do: tools, whose list never
 * changes while a session lasts. */
export const MCP_SERVER_CAPABILITIES = {
  tools: { listChanged: false },
} as const;

/** Who the server is. `version` is the API contract's — one number for the
 * REST and the MCP surface, moved by every change to either. */
export const MCP_SERVER_INFO = {
  name: 'tale-platform',
  title: 'Tale platform',
  version: API_CONTRACT_VERSION,
  description:
    'Edit, check, test, deploy and debug the automations of a Tale organization.',
  websiteUrl: 'https://docs.tale.dev/develop/mcp-endpoint',
} as const;
