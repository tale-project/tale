'use client';

import { Button } from '@tale/ui/button';
import { Card } from '@tale/ui/card';
import { cn } from '@tale/ui/cn';
import { FlowPathList } from '@tale/ui/flow/flow-path-list';
import { IconButton } from '@tale/ui/icon-button';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogTitle,
} from '@tale/ui/responsive-dialog';
import { Route, X } from 'lucide-react';
import { useId } from 'react';

import { useT } from '@/lib/i18n/client';

import type { AutomationPaths, PathRowInfo } from '../lib/paths';

/**
 * The possible paths, beside the chart they light up.
 *
 * A Paths button among the canvas's verbs opens the list: on a wide screen
 * as a panel under the view switch, which stays open while the reader
 * clicks nodes (a popover would close exactly when exploring needs it), on
 * a narrow one as a sheet. Pointing at or focusing a path previews it,
 * Enter or a click pins it; in the sheet a pin closes the sheet and leaves
 * a pill on the canvas that says which path is shown, with Show all.
 */

interface PathListProps {
  paths: AutomationPaths;
  previewId: string | null;
  pinnedId: string | null;
  onPreview: (id: string | null) => void;
  onPin: (id: string | null) => void;
  /** A halting node was chosen: select it. */
  onActivate: (nodeId: string) => void;
}

function PathList({
  paths,
  previewId,
  pinnedId,
  onPreview,
  onPin,
  onActivate,
}: PathListProps) {
  const { t } = useT('automations');
  return (
    <FlowPathList
      aria-label={t('paths.title')}
      sections={paths.sections}
      previewId={previewId}
      pinnedId={pinnedId}
      onPreview={onPreview}
      onPin={onPin}
      onActivate={(rowId) => {
        const nodeId = paths.haltNode(rowId);
        if (nodeId !== null) onActivate(nodeId);
      }}
    />
  );
}

/** The canvas's Paths verb: how many ways a run can go. */
export function AutomationPathsButton({
  count,
  open,
  controls,
  onToggle,
}: {
  count: number;
  open: boolean;
  /** The panel's id while it is open. */
  controls: string | undefined;
  onToggle: () => void;
}) {
  const { t } = useT('automations');
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      icon={Route}
      collapseLabel
      aria-expanded={open}
      aria-controls={controls}
      onClick={onToggle}
    >
      {t('paths.button', { count })}
    </Button>
  );
}

/** The list as a panel inside the canvas, for a wide screen. */
export function AutomationPathsPanel({
  id,
  onClose,
  ...list
}: PathListProps & { id: string; onClose: () => void }) {
  const { t } = useT('automations');
  const { t: tCommon } = useT('common');
  const titleId = useId();
  return (
    <Card
      asChild
      padding="none"
      // `nowheel`/`nopan`: scrolling the list never zooms or moves the
      // chart behind it.
      className={cn(
        'nowheel nopan flex max-h-[45vh] w-80 max-w-[calc(100vw-2rem)] flex-col overflow-hidden shadow-md',
        'animate-in fade-in slide-in-from-top-1 duration-[var(--duration-standard)] ease-[var(--ease-out-quint)] motion-reduce:animate-none',
      )}
    >
      <section id={id} aria-labelledby={titleId}>
        <header className="flex items-start gap-2 px-3 pt-3 pb-2">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h2 id={titleId} className="text-sm font-medium">
              {t('paths.title')}
            </h2>
            <p className="text-muted-foreground text-xs">
              {t('paths.description')}
            </p>
          </div>
          <IconButton
            icon={X}
            size="sm"
            aria-label={tCommon('actions.close')}
            onClick={onClose}
          />
        </header>
        <div className="overflow-y-auto pb-2">
          <PathList {...list} />
        </div>
      </section>
    </Card>
  );
}

/** The list in a sheet, for a narrow screen: a pin closes it. */
export function AutomationPathsSheet({
  open,
  onOpenChange,
  onPin,
  onActivate,
  ...list
}: PathListProps & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useT('automations');
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="flex flex-col gap-3">
        <ResponsiveDialogTitle>{t('paths.title')}</ResponsiveDialogTitle>
        <ResponsiveDialogDescription>
          {t('paths.description')}
        </ResponsiveDialogDescription>
        <PathList
          {...list}
          onPin={(id) => {
            onPin(id);
            if (id !== null) onOpenChange(false);
          }}
          onActivate={(nodeId) => {
            onOpenChange(false);
            onActivate(nodeId);
          }}
        />
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

/** Which path the chart shows, once the sheet has closed on it. */
export function AutomationPathsPill({
  info,
  onShowAll,
}: {
  info: PathRowInfo;
  onShowAll: () => void;
}) {
  const { t } = useT('automations');
  const { t: tFlow } = useT('flow');
  return (
    <div className="bg-background border-border animate-in fade-in flex h-8 items-center gap-2 rounded-full border pr-1 pl-3 text-xs shadow-sm duration-[var(--duration-short)] motion-reduce:animate-none">
      <span className="truncate">
        {t('paths.pill', {
          index: info.index,
          ran: info.ran,
          total: info.total,
        })}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-6 rounded-full px-2"
        onClick={onShowAll}
      >
        {tFlow('paths.showAll')}
      </Button>
    </div>
  );
}
