'use client';

import { Button } from '@tale/ui/button';
import { cn } from '@tale/ui/cn';
import { Stack } from '@tale/ui/layout';
import { Popover } from '@tale/ui/popover';
import { Text } from '@tale/ui/text';
import { Link } from '@tanstack/react-router';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { useCanUseAutomations } from '@/app/features/automations/hooks/use-can-use-automations';
import {
  ProjectAgentDetailsContent,
  ProjectAgentDetailsDialog,
} from '@/app/features/projects/components/project-agent-details';
import { useT } from '@/lib/i18n/client';

import type { TaskActorPreview } from '../utils/task-actor-preview';

const HOVER_OPEN_MS = 300;
const HOVER_CLOSE_MS = 120;

interface TaskActorPreviewPopoverProps {
  preview: TaskActorPreview;
  children: ReactNode;
  className?: string;
}

/**
 * Hover/focus preview for agent and workflow actors in the task timeline.
 * Uses a Popover (not a Tooltip) so the View link stays interactive.
 */
function TaskActorPreviewPopover({
  preview,
  children,
  className,
}: TaskActorPreviewPopoverProps) {
  const { t } = useT('tasks');
  const [open, setOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const skipNextFocus = useRef(false);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearOpenTimer = useCallback(() => {
    if (openTimer.current !== null) {
      clearTimeout(openTimer.current);
      openTimer.current = null;
    }
  }, []);

  const clearCloseTimer = useCallback(() => {
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const scheduleOpen = useCallback(() => {
    if (detailsOpen) return;
    clearCloseTimer();
    clearOpenTimer();
    openTimer.current = setTimeout(() => setOpen(true), HOVER_OPEN_MS);
  }, [clearCloseTimer, clearOpenTimer, detailsOpen]);

  const scheduleClose = useCallback(() => {
    clearOpenTimer();
    clearCloseTimer();
    closeTimer.current = setTimeout(() => setOpen(false), HOVER_CLOSE_MS);
  }, [clearCloseTimer, clearOpenTimer]);

  useEffect(
    () => () => {
      clearOpenTimer();
      clearCloseTimer();
    },
    [clearOpenTimer, clearCloseTimer],
  );
  // A workflow's page is an automation page, closed to anyone who may not
  // use Automations; they keep the name and the description.
  const canUseAutomations = useCanUseAutomations();
  const showView = preview.kind === 'workflow' && canUseAutomations;

  return (
    <>
      <Popover
        open={open}
        onOpenChange={setOpen}
        align="start"
        side="top"
        sideOffset={6}
        contentClassName="w-80 max-w-[calc(100vw-2rem)] p-0"
        onOpenAutoFocus={(event) => event.preventDefault()}
        trigger={
          <button
            ref={triggerRef}
            type="button"
            className={cn(
              'text-foreground hover:text-primary focus-visible:ring-ring rounded-sm font-medium underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:outline-none',
              className,
            )}
            onMouseEnter={scheduleOpen}
            onMouseLeave={scheduleClose}
            onFocus={() => {
              if (skipNextFocus.current) {
                skipNextFocus.current = false;
                return;
              }
              scheduleOpen();
            }}
            onBlur={scheduleClose}
          >
            {children}
          </button>
        }
      >
        <div
          className="space-y-3 p-4"
          onMouseEnter={clearCloseTimer}
          onMouseLeave={scheduleClose}
        >
          <Stack gap={1}>
            <Text as="p" variant="label" className="text-sm">
              {preview.name}
            </Text>
            {preview.description && !preview.agent ? (
              <Text as="p" variant="muted" className="line-clamp-3 text-xs">
                {preview.description}
              </Text>
            ) : null}
          </Stack>
          {preview.kind === 'agent' && preview.agent ? (
            <>
              <ProjectAgentDetailsContent agent={preview.agent} compact />
              <Button
                variant="secondary"
                size="sm"
                className="w-full"
                onClick={() => {
                  clearOpenTimer();
                  clearCloseTimer();
                  skipNextFocus.current = true;
                  setOpen(false);
                  setDetailsOpen(true);
                }}
              >
                {t('timeline.viewMore')}
              </Button>
            </>
          ) : null}
          {showView ? (
            <Button asChild variant="secondary" size="sm" className="w-full">
              <Link
                to={preview.viewTo}
                params={preview.viewParams}
                search={preview.viewSearch}
              >
                {t('timeline.viewWorkflow')}
              </Link>
            </Button>
          ) : null}
        </div>
      </Popover>
      {preview.kind === 'agent' && preview.agent ? (
        <ProjectAgentDetailsDialog
          agent={preview.agent}
          open={detailsOpen}
          onOpenChange={setDetailsOpen}
          restoreFocusRef={triggerRef}
        />
      ) : null}
    </>
  );
}

interface TaskActorNameProps {
  preview: TaskActorPreview | null;
  name: string;
  className?: string;
}

/** Renders a plain name or a preview trigger when preview data exists. */
export function TaskActorName({
  preview,
  name,
  className,
}: TaskActorNameProps) {
  if (!preview) {
    return (
      <span className={cn('text-foreground font-medium', className)}>
        {name}
      </span>
    );
  }
  return (
    <TaskActorPreviewPopover preview={preview} className={className}>
      {name}
    </TaskActorPreviewPopover>
  );
}
