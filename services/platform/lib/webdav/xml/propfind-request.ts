import { createWebdavXmlParser, isRecord, pick } from './parse';

export type PropfindRequest =
  | { kind: 'allprop' }
  | { kind: 'propname' }
  | { kind: 'prop'; props: string[] };

// RFC 4918 §9.1.1: empty body is equivalent to <allprop/>. Many clients
// (Finder included) send an empty body. We default to allprop.
const DEFAULT_REQUEST: PropfindRequest = { kind: 'allprop' };

const xmlParser = createWebdavXmlParser();

export function parsePropfindBody(body: string): PropfindRequest {
  const trimmed = body.trim();
  if (trimmed.length === 0) return DEFAULT_REQUEST;

  let parsed: unknown;
  try {
    parsed = xmlParser.parse(trimmed);
  } catch {
    return DEFAULT_REQUEST;
  }

  if (!isRecord(parsed)) return DEFAULT_REQUEST;
  const propfind = pick(parsed, 'propfind');
  if (!isRecord(propfind)) return DEFAULT_REQUEST;

  if ('propname' in propfind) return { kind: 'propname' };
  if ('allprop' in propfind) return { kind: 'allprop' };
  const propNode = pick(propfind, 'prop');
  if (!isRecord(propNode)) return DEFAULT_REQUEST;
  const props = Object.keys(propNode);
  if (props.length === 0) return DEFAULT_REQUEST;
  return { kind: 'prop', props };
}
