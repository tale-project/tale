import { installAcceptanceOracle } from './acceptance-oracle.js';
import type { ExpectedBoard, ExpectedGeneral } from './browser-session.ts';

/** Install and arm in ONE document-start script. Waiting for DOMContentLoaded
 * could miss an already-complete fast page; separate init scripts have no
 * guaranteed order. Fixture values are JSON literals, never executable source. */
export function acceptanceInitScript(
  board: ExpectedBoard,
  general: ExpectedGeneral,
  initial: 'board' | 'general',
) {
  return `(${installAcceptanceOracle.toString()})();\nwindow.__benchmarkReady = window.__acceptance.${initial === 'board' ? 'watchBoard' : 'watchGeneral'}(${JSON.stringify(initial === 'board' ? board : general)}, {requireFalse:true});`;
}
