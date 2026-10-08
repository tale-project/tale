import { API_CONTRACT_VERSION } from '../shared/constants/api-contract';

/**
 * What the MCP endpoint says about itself, in one place: the protocol
 * revisions it speaks, what it can do, who it is, and how long a client may
 * keep what it answers. The protocol layer answers them; the contract
 * fingerprint (`contract.ts`) covers the revisions and the capabilities.
 */

/**
 * The revisions that carry everything a request needs in the request
 * itself (MCP's "modern" era): the revision, the client's capabilities and
 * its name ride `params._meta` on every request, mirrored into HTTP
 * headers, and there is no `initialize` — `server/discover` says what the
 * server speaks. Served without any state between requests.
 */
export const MCP_MODERN_PROTOCOL_VERSIONS: readonly string[] = ['2026-07-28'];

/**
 * The revisions a client opens with `initialize` (MCP's "legacy" era),
 * newest first. `initialize` echoes a client's proposal when it is one of
 * these and answers the newest otherwise (the lifecycle's rule for a
 * proposal the server lacks). All three fit a JSON-only tools server:
 * 2025-03-26 requires receiving batches, which the transport does;
 * 2025-06-18 added the `MCP-Protocol-Version` header; 2025-11-25 made
 * argument errors tool errors and JSON Schema 2020-12 the default dialect,
 * both of which this server follows for every revision.
 */
export const MCP_LEGACY_PROTOCOL_VERSIONS: readonly string[] = [
  '2025-11-25',
  '2025-06-18',
  '2025-03-26',
];

/** Every revision this endpoint speaks, newest first — what a request
 * naming another is refused with (`-32022`, `data.supported`) and what
 * `server/discover` lists. One endpoint serves both eras, request by
 * request. */
export const MCP_PROTOCOL_VERSIONS: readonly string[] = [
  ...MCP_MODERN_PROTOCOL_VERSIONS,
  ...MCP_LEGACY_PROTOCOL_VERSIONS,
];

/** What the server can do: tools, resources and prompts, none of whose
 * lists changes while the server runs, and no resource a client can
 * subscribe to. `initialize` and `server/discover` answer it alike. */
export const MCP_SERVER_CAPABILITIES = {
  tools: { listChanged: false },
  resources: { subscribe: false, listChanged: false },
  prompts: { listChanged: false },
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

/**
 * Who may keep a cached answer, on the modern revision: every answer is
 * the key holder's own — the automations and runs they may see, and lists
 * served behind their key — so a cache is never shared between two
 * credentials.
 */
export const MCP_CACHE_SCOPE = 'private';

/** How long a client may treat an answer as fresh, in milliseconds, on the
 * modern revision. What changes only with a release of the server — its
 * description, the tools, prompts and address templates, the references —
 * for an hour; the list of resources, which names the automations, for a
 * minute. What a single read answers is set per address
 * (`resourceFreshnessMs` in `resources.ts`). */
export const MCP_FRESH_FOR_A_RELEASE_MS = 3_600_000;
export const MCP_FRESH_FOR_A_LISTING_MS = 60_000;
