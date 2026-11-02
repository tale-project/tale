// The limits the proxies a person adds are held to. The server enforces them
// (`backend/domains/proxies/parsing.ts` and the schemas of `lib/api/schemas.ts`)
// and the MCP tools take the same schemas: one definition, which all import.

/**
 * The most characters a proxy line can have. A proxy is a host (at most 253
 * characters) and, at most, a user name and a password of 255 bytes each, even
 * written as percent escapes: far below this.
 */
export const MAX_PROXY_LINE = 2048;

/**
 * The most characters a pasted or imported list of proxy lines can have (about
 * 20,000 proxies). Large enough for any provider's export, small enough that
 * reading it never keeps the server from answering anyone else.
 */
export const MAX_PROXY_IMPORT = 1_000_000;
