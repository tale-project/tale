import { XMLParser } from 'fast-xml-parser';

/** Narrow an unknown fast-xml-parser node to a plain object. */
export function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/** Read a child node by tag name from a parsed record. */
export function pick(obj: Record<string, unknown>, key: string): unknown {
  return obj[key];
}

/**
 * Shared fast-xml-parser config for WebDAV request bodies: attributes are
 * irrelevant to element-name parsing, namespace prefixes are stripped so
 * `D:propfind` and `propfind` collapse, and tag values stay raw strings. Each
 * caller gets its own parser instance, matching the previous per-file setup.
 */
export function createWebdavXmlParser(): XMLParser {
  return new XMLParser({
    ignoreAttributes: true,
    removeNSPrefix: true,
    parseTagValue: false,
  });
}
