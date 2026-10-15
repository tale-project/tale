'use client';

import { useFormatDate } from '@tale/ui/use-format-date';
import { useRecurrenceFormat } from '@tale/ui/use-recurrence-format';
import { useMemo } from 'react';

import type { Automation } from '@/lib/engine/core/types';
import { useT } from '@/lib/i18n/client';

import { mergeNodeTypes } from '../hooks/backend';
import { useNodeTypeCatalog } from '../hooks/queries';
import { readDocument } from '../lib/document';
import { nodeCatalogView } from '../lib/node-face';
import type { TemplateCard } from '../lib/templates';
import { triggerLines, triggerRows } from '../lib/trigger-summary';
import { AutomationCanvas } from './automation-canvas';

/**
 * A template's workflow as the editor will draw it, read-only: the same
 * canvas, its connector steps wearing their products' icons, and Start
 * saying what starts it — a schedule in the reader's own time zone, since
 * that is where it will run. Nothing opens from a box. Loaded the first
 * time a preview shows it: the canvas and its layout engine are weight the
 * automations list should not carry before anyone previews a template.
 */
export function TemplatePreviewFlow({
  organizationId,
  slug,
  document,
  trigger,
  viewerZone,
}: {
  organizationId: string;
  slug: string;
  /** The document the template creates, as the catalog answers it. */
  document: unknown;
  trigger: TemplateCard['trigger'];
  viewerZone: string;
}) {
  const { t } = useT('automations');
  const { schedule: scheduleText } = useRecurrenceFormat();
  const { formatDate } = useFormatDate();
  const catalogQuery = useNodeTypeCatalog(organizationId);
  const catalog = useMemo(
    () =>
      nodeCatalogView(
        mergeNodeTypes(catalogQuery.data?.nodeTypes),
        catalogQuery.data?.connectors ?? [],
      ),
    [catalogQuery.data],
  );
  const automation = useMemo<Automation | null>(
    () => readDocument(document),
    [document],
  );
  const triggers = useMemo(
    () =>
      triggerRows(
        triggerLines(
          trigger === null
            ? []
            : [
                {
                  kind: trigger.kind,
                  // What it will do once started: no state to say.
                  enabled: true,
                  ...(trigger.kind === 'schedule' && {
                    repeat: trigger.repeat,
                    cron: trigger.cron,
                    timezone: viewerZone,
                  }),
                  ...(trigger.kind === 'event' && { event: trigger.event }),
                },
              ],
          { deployed: true, t, scheduleText },
        ),
        { t, formatDate: (at) => formatDate(at, 'long') },
      ),
    [trigger, viewerZone, t, scheduleText, formatDate],
  );
  if (automation === null) return null;
  return (
    <AutomationCanvas
      automation={automation}
      layoutKey={`template:${slug}`}
      catalog={catalog}
      triggers={triggers}
      // A preview: nothing opens, nothing is checked.
      selectedId={null}
      onSelect={() => undefined}
    />
  );
}
