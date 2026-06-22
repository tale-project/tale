'use client';

/**
 * Renders one region of Puck Data through the Tale registry. The runtime context
 * (org + the app's function allowlist) is provided once by the app page that
 * hosts the tabbed shell, so this is just the headless `<Render>` — usable per
 * tab and per column.
 */
import { type Data, Render } from '@measured/puck';

import { taleConfig } from './tale-config';

export function AppView({ data }: { data: unknown }) {
  // The view is a Puck Data document from the app bundle; Render tolerates shape
  // at runtime, and its Data type is too structural to hand-guard.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return <Render config={taleConfig} data={data as Data} />;
}
