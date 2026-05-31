import type { WebDAVResponse } from '../types';

const DAV_METHODS =
  'OPTIONS, GET, HEAD, PROPFIND, PROPPATCH, PUT, DELETE, MKCOL, MOVE, COPY, LOCK, UNLOCK';

export function handleOptions(): WebDAVResponse {
  return {
    status: 200,
    headers: {
      // Class 2 = supports LOCK / UNLOCK. Some Windows clients refuse
      // to write without Class 2 advertised.
      DAV: '1, 2',
      Allow: DAV_METHODS,
      // Windows-specific opt-in that fixes "WebDAV folders not
      // working" on some older configurations.
      'MS-Author-Via': 'DAV',
      'Microsoft-Server-WebDAV-Extensions': '1',
      'Content-Length': '0',
    },
    body: null,
  };
}
