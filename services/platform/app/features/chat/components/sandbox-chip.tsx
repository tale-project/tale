'use client';

import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { Row } from '@tale/ui/layout';
import { Popover } from '@tale/ui/popover';
import { useAction, useMutation } from 'convex/react';
import { AlertTriangle, Box, Loader2, Moon, Pin } from 'lucide-react';
import { type ComponentType, useCallback, useId, useState } from 'react';

import { Input } from '@/app/components/ui/forms/input';
import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { usePrefersReducedMotion } from '@/app/hooks/use-prefers-reduced-motion';
import { useToast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
import {
  type SandboxWorkdirError,
  normalizeSandboxWorkdir,
  sandboxWorkdirError,
} from '@/lib/shared/sandbox-workdir';
import { cn } from '@/lib/utils/cn';

import { useChatLayout } from '../context/chat-layout-context';
import {
  useChatAgents,
  isAgentActivelyWorking,
  useSessionProgress,
  useThreadSandboxState,
} from '../hooks/queries';
import { useThreadAgentLock } from '../hooks/use-thread-agent-lock';

interface SandboxChipProps {
  threadId: string | undefined;
  organizationId: string;
  disabled?: boolean;
}

// Always-spinning loader so the Badge `icon` prop (which only passes a
// className) can still animate. The reduced-motion branch swaps in the plain
// Loader2 instead.
function SpinningLoader({ className }: { className?: string }) {
  return <Loader2 className={cn(className, 'animate-spin')} />;
}

// Three calm buckets per the cross-product convention (Gitpod/Codespaces/VS
// Code): green = alive (warm or working), slate = dormant (sleeping / not yet
// provisioned — a normal, recoverable, data-preserved state, NOT an alarming
// red/yellow), orange = transitional (starting / recovering). Filled fills give
// the chip its own visual language so it doesn't blend into the ghost/outline
// toolbar controls beside it.
type SandboxBadgeVariant = 'green' | 'slate' | 'orange';

/**
 * Composer pill that mirrors the thread's sandbox VM lifecycle AND is the
 * entry to the thread's sandbox settings: clicking it opens a popover —
 * today just the working directory (`threadMetadata.sandboxWorkdir`, where
 * the external agent's CLI starts every turn), extensible with further
 * per-thread sandbox settings later. A custom workdir applies from the NEXT
 * turn; while the folder doesn't exist yet, turns run at the workspace root
 * (an advisory toast on save makes that visible, never silent).
 *
 * Self-gating: renders only when the composer's active agent is an external
 * agent (Claude Code OR OpenCode — the sandbox fact is CLI-agnostic, unlike
 * the claude-code-only Plan/Act toggle). Before the thread exists the popover
 * edits the layout context's STAGED workdir (`pendingSandboxWorkdir`), which
 * `useSendMessage` applies to the thread it creates — so the first turn
 * already runs there. Only while the composer is disabled (mid-turn) does the
 * pill fall back to purely informational.
 */
export function SandboxChip({
  threadId,
  organizationId,
  disabled,
}: SandboxChipProps) {
  const { t } = useT('chat');
  const { toast } = useToast();
  const inputId = useId();
  const prefersReducedMotion = usePrefersReducedMotion();
  const { selectedAgent, pendingSandboxWorkdir, setPendingSandboxWorkdir } =
    useChatLayout();
  const { agents } = useChatAgents(organizationId);

  // The thread's bound agent wins over the global per-user selection — a
  // switch made in ANOTHER thread must not hide this thread's sandbox pill.
  const { lockedAgent } = useThreadAgentLock(organizationId, threadId);
  const active =
    lockedAgent ??
    (selectedAgent
      ? agents?.find((a) => a.name === selectedAgent.name)
      : undefined);
  const isExternal = active?.primaryBehavior === 'external-agent';

  // Only subscribe on external-agent threads — a normal chat thread passes
  // `undefined` (→ 'skip'), so it costs no live subscription / indexed read.
  const gatedThreadId = isExternal ? threadId : undefined;
  const { state } = useThreadSandboxState(gatedThreadId);
  const progress = useSessionProgress(gatedThreadId);
  const { data: meta } = useConvexQuery(
    api.threads.queries.getThreadMeta,
    gatedThreadId && organizationId
      ? { threadId: gatedThreadId, organizationId }
      : 'skip',
  );
  const setWorkdir = useMutation(api.threads.mutations.setSandboxWorkdir);
  const listWorkspaceDir = useAction(
    api.node_only.sandbox.workspace_files.listWorkspaceDir,
  );

  // Pre-thread the pill edits the STAGED workdir (applied at thread creation
  // by useSendMessage); once the thread exists the server value is the truth.
  const workdir = threadId
    ? (meta?.sandboxWorkdir ?? '')
    : pendingSandboxWorkdir;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const errorMessage = useCallback(
    (reason: SandboxWorkdirError): string => {
      if (reason === 'absolute') return t('workdir.errors.absolute');
      if (reason === 'too-long') return t('workdir.errors.tooLong');
      return t('workdir.errors.badSegment');
    },
    [t],
  );

  const handleOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (next) {
        setDraft(workdir);
        setError(null);
      }
    },
    [workdir],
  );

  const persist = useCallback(
    async (rel: string) => {
      if (!threadId) {
        // No thread yet: stage in the layout context — useSendMessage applies
        // it to the thread the first send creates. No existence probe either
        // (there is no workspace to probe yet; the missing-folder fallback is
        // surfaced by the post-create save path and the turn itself).
        setPendingSandboxWorkdir(rel);
        setOpen(false);
        return;
      }
      setSaving(true);
      try {
        await setWorkdir({ threadId, workdir: rel });
        setOpen(false);
        // Advisory existence probe: a missing folder means turns fall back to
        // the workspace root until it's created (e.g. saved before cloning) —
        // surface that now instead of letting the fallback happen silently.
        if (rel !== '') {
          try {
            const lastSlash = rel.lastIndexOf('/');
            const parent =
              lastSlash === -1
                ? 'workspace'
                : `workspace/${rel.slice(0, lastSlash)}`;
            const leaf = lastSlash === -1 ? rel : rel.slice(lastSlash + 1);
            const listing = await listWorkspaceDir({
              threadId,
              path: parent,
              showHidden: true,
            });
            const exists = listing.entries.some(
              (entry) => entry.type === 'dir' && entry.name === leaf,
            );
            if (listing.sessionRunning && !exists) {
              toast({ title: t('workdir.missingWarning') });
            }
          } catch (probeErr) {
            console.warn('[sandbox-chip] existence probe failed:', probeErr);
          }
        }
      } catch (err) {
        console.error('[sandbox-chip] save failed', err);
        toast({ title: t('workdir.saveFailed'), variant: 'destructive' });
      } finally {
        setSaving(false);
      }
    },
    [
      threadId,
      setPendingSandboxWorkdir,
      setWorkdir,
      listWorkspaceDir,
      toast,
      t,
    ],
  );

  const handleSave = useCallback(() => {
    const rel = normalizeSandboxWorkdir(draft);
    const reason = sandboxWorkdirError(rel);
    if (reason !== null) {
      setError(errorMessage(reason));
      return;
    }
    void persist(rel);
  }, [draft, errorMessage, persist]);

  const handleReset = useCallback(() => {
    setDraft('');
    void persist('');
  }, [persist]);

  if (!isExternal) return null;
  // "Working" means a turn is actively running — NOT steer-ready linger on
  // held-open stdin. Background tasks still count as working.
  const running = isAgentActivelyWorking(meta?.isGenerating, progress);

  const Spinner = prefersReducedMotion ? Loader2 : SpinningLoader;

  let variant: SandboxBadgeVariant;
  let icon: ComponentType<{ className?: string }>;
  let stateLabel: string | null;
  let stateTooltip: string;

  if (running) {
    variant = 'green';
    icon = Spinner; // the only state that animates — motion = "happening now"
    stateLabel = t('sandbox.working');
    stateTooltip = t('sandbox.workingTooltip');
  } else if (state?.status === 'stopped') {
    variant = 'slate';
    icon = Moon;
    stateLabel = t('sandbox.sleeping');
    stateTooltip = t('sandbox.sleepingTooltip');
  } else if (state?.status === 'creating') {
    variant = 'orange';
    icon = Spinner;
    stateLabel = t('sandbox.starting');
    stateTooltip = t('sandbox.startingTooltip');
  } else if (state?.status === 'degraded') {
    variant = 'orange';
    icon = AlertTriangle;
    stateLabel = t('sandbox.recovering');
    stateTooltip = t('sandbox.recoveringTooltip');
  } else if (state?.status === 'active') {
    // Warm container, idle — the next message starts instantly.
    variant = 'green';
    icon = Box;
    stateLabel = t('sandbox.ready');
    stateTooltip = t('sandbox.readyTooltip');
  } else {
    // No live session yet (the agent is selected but hasn't run in this
    // thread): show the resting identity so the user perceives the sandbox VM
    // before the first turn provisions it.
    variant = 'slate';
    icon = Box;
    stateLabel = null;
    stateTooltip = t('sandbox.tooltip');
  }

  // The visible label stays just "Sandbox" so the chip stays compact in a busy
  // composer toolbar (agent picker + model picker + Plan/Act already compete for
  // width). The live state rides on color + icon + tooltip, with the state word
  // folded into the accessible name for screen readers — the same identity-only
  // + color approach as VS Code's remote-status pill. `shrink-0` keeps it from
  // being squeezed into a truncated "Sandbox · W…".
  const identity = t('sandbox.label');
  const accessibleLabel = stateLabel ? `${identity} · ${stateLabel}` : identity;

  // Mid-turn the composer disables its controls (`attachDisabled`) — keep the
  // state display alive as a plain informational pill (a disabled button would
  // also swallow the tooltip). Pre-thread stays interactive: the popover then
  // edits the staged workdir the first send applies.
  const interactive = !disabled;
  // If a turn starts while the popover is open (queued send picking up), the
  // interactive branch unmounts with `open` stuck true — which would pop the
  // popover back open unprompted when the turn ends. Reset during render.
  if (!interactive && open) setOpen(false);
  const isCustomWorkdir = workdir !== '';

  const tooltipContent = interactive ? (
    <div className="flex flex-col gap-1">
      <p>{stateTooltip}</p>
      {isCustomWorkdir && (
        <p>
          {t('workdir.label')}: <span className="font-mono">{workdir}</span>
        </p>
      )}
      <p className="text-muted-foreground">{t('sandbox.settingsHint')}</p>
    </div>
  ) : (
    stateTooltip
  );

  const badge = (
    <Badge variant={variant} icon={icon} className="h-8 rounded-full">
      {identity}
    </Badge>
  );

  return (
    <Row gap={1}>
      {interactive ? (
        // Raw tooltip primitives, NOT the app `Tooltip` wrapper: the popover
        // trigger slots its props (onClick, aria) onto its child via Radix
        // `asChild`, and a plain function component like the wrapper drops
        // them — the pill would render but never open. Nesting
        // `TooltipPrimitive.Trigger asChild` inside the popover trigger keeps
        // both Slot chains on forwarding components (the `user-button`
        // precedent for exactly this trigger+tooltip composition).
        <TooltipPrimitive.Provider delayDuration={300}>
          <TooltipPrimitive.Root>
            <Popover
              open={open}
              onOpenChange={handleOpenChange}
              align="start"
              side="top"
              contentClassName="w-80 max-w-80 p-3"
              trigger={
                <TooltipPrimitive.Trigger asChild>
                  <button
                    type="button"
                    aria-label={accessibleLabel}
                    className="inline-flex shrink-0 cursor-pointer rounded-full"
                  >
                    {badge}
                  </button>
                </TooltipPrimitive.Trigger>
              }
            >
              <div className="flex flex-col gap-2">
                <h3 className="text-xs font-semibold">
                  {t('sandbox.settingsTitle')}
                </h3>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    handleSave();
                  }}
                  className="flex flex-col gap-2"
                >
                  <label
                    htmlFor={inputId}
                    className="text-muted-foreground text-xs font-medium"
                  >
                    {t('workdir.label')}
                  </label>
                  <Input
                    id={inputId}
                    value={draft}
                    onChange={(event) => {
                      setDraft(event.target.value);
                      setError(null);
                    }}
                    placeholder={t('workdir.placeholder')}
                    className="h-8 font-mono text-base md:text-xs"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  {error !== null ? (
                    <p role="alert" className="text-destructive text-xs">
                      {error}
                    </p>
                  ) : (
                    <p className="text-muted-foreground text-xs">
                      {t('workdir.helper')}
                    </p>
                  )}
                  <Row gap={2} className="justify-end">
                    {isCustomWorkdir && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={handleReset}
                        disabled={saving}
                      >
                        {t('workdir.reset')}
                      </Button>
                    )}
                    <Button
                      type="submit"
                      size="sm"
                      disabled={saving || draft === workdir}
                    >
                      {t('workdir.save')}
                    </Button>
                  </Row>
                </form>
              </div>
            </Popover>
            <TooltipPrimitive.Portal>
              <TooltipPrimitive.Content
                side="top"
                sideOffset={4}
                collisionPadding={8}
                className="bg-foreground text-background animate-in fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 z-[60] max-w-xs overflow-hidden rounded-lg border p-2 py-1 text-xs shadow-md"
              >
                {tooltipContent}
              </TooltipPrimitive.Content>
            </TooltipPrimitive.Portal>
          </TooltipPrimitive.Root>
        </TooltipPrimitive.Provider>
      ) : (
        <Tooltip
          content={tooltipContent}
          side="top"
          contentClassName="max-w-xs"
        >
          <span
            className="inline-flex shrink-0 cursor-help"
            aria-label={accessibleLabel}
          >
            {badge}
          </span>
        </Tooltip>
      )}
      {state?.pinned && (
        <Tooltip content={t('sandbox.pinnedTooltip')} side="top">
          <span className="inline-flex shrink-0 cursor-help">
            <Badge variant="blue" icon={Pin} className="h-8 rounded-full">
              {t('sandbox.pinned')}
            </Badge>
          </span>
        </Tooltip>
      )}
    </Row>
  );
}
