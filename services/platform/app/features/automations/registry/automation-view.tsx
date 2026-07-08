'use client';

/**
 * Renders one region of Puck Data through the Tale registry. The runtime context
 * (org + the automation's function allowlist) is provided once by the automation page that
 * hosts the tabbed shell, so this is just the headless `<Render>` — usable per
 * tab and per column. Each instance also mounts the view's cross-block state
 * store (`$state.<key>`/`$selection.ids` sentinels); a nested provider adopts
 * its ancestor, so a layout shell that renders one `AutomationView` per column can
 * provide ONE store above them for cross-column master-detail.
 */
import { type Data, Render } from '@measured/puck';

import { ViewStateProvider } from '../runtime/view-state';
import { taleConfig } from './tale-config';

export function AutomationView({ data }: { data: unknown }) {
  // The view is a Puck Data document from the automation bundle; Render tolerates shape
  // at runtime, and its Data type is too structural to hand-guard.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const viewData = data as Data;
  return (
    <ViewStateProvider>
      <Render config={taleConfig} data={viewData} />
    </ViewStateProvider>
  );
}
