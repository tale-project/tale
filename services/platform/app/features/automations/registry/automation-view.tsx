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
import { useMemo } from 'react';

import { ViewStateProvider } from '../runtime/view-state';
import { taleConfig } from './tale-config';

type PuckItem = Data['content'][number];

/** Puck keys rendered children by `item.props.id`, but only editor-inserted
 *  nodes carry one — hand-authored bundle JSON usually doesn't. Stamp a
 *  deterministic id on id-less items so React gets stable keys. Items with
 *  explicit ids keep them (zone compounds reference those). */
export function withStableItemIds(data: Data): Data {
  const stamp = (items: PuckItem[] | undefined, scope: string): PuckItem[] =>
    // oxlint-disable-next-line oxc/no-map-spread -- immutable update required
    (items ?? []).map((item, index) =>
      item.props?.id
        ? item
        : {
            ...item,
            props: { ...item.props, id: `${scope}:${item.type}-${index}` },
          },
    );
  return {
    ...data,
    content: stamp(data.content, 'content'),
    zones: data.zones
      ? Object.fromEntries(
          Object.entries(data.zones).map(([zone, items]) => [
            zone,
            stamp(items, zone),
          ]),
        )
      : data.zones,
  };
}

export function AutomationView({ data }: { data: unknown }) {
  // The view is a Puck Data document from the automation bundle; Render tolerates shape
  // at runtime, and its Data type is too structural to hand-guard.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const viewData = useMemo(() => withStableItemIds(data as Data), [data]);
  return (
    <ViewStateProvider>
      <Render config={taleConfig} data={viewData} />
    </ViewStateProvider>
  );
}
