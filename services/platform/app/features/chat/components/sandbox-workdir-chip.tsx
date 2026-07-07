'use client';

import { Button } from '@tale/ui/button';
import { Row } from '@tale/ui/layout';
import { Popover } from '@tale/ui/popover';
import { useAction, useMutation } from 'convex/react';
import { Folder } from 'lucide-react';
import { useCallback, useId, useState } from 'react';

import { Input } from '@/app/components/ui/forms/input';
import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
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
import { useChatAgents } from '../hooks/queries';
import { useThreadAgentLock } from '../hooks/use-thread-agent-lock';

interface SandboxWorkdirChipProps {
  threadId: string | undefined;
  organizationId: string;
  disabled?: boolean;
}

/**
 * Composer chip for the thread's sandbox working directory
 * (`threadMetadata.sandboxWorkdir`) — where the external agent's CLI starts
 * every turn. Default is the workspace root; pointing it at a repo folder
 * makes the agent discover that repo's own CLAUDE.md / project skills.
 * Applies from the NEXT turn; while the folder doesn't exist yet, turns run
 * at the root (an advisory toast on save makes that visible, never silent).
 *
 * Self-gating like the Plan/Act toggle: renders only on external-agent
 * threads. The chip doubles as the ambient indicator of the active setting.
 */
export function SandboxWorkdirChip({
  threadId,
  organizationId,
  disabled,
}: SandboxWorkdirChipProps) {
  const { t } = useT('chat');
  const { toast } = useToast();
  const inputId = useId();
  const { selectedAgent } = useChatLayout();
  const { agents } = useChatAgents(organizationId);
  const { lockedAgent } = useThreadAgentLock(organizationId, threadId);
  const { data: meta } = useConvexQuery(
    api.threads.queries.getThreadMeta,
    threadId && organizationId ? { threadId, organizationId } : 'skip',
  );
  const setWorkdir = useMutation(api.threads.mutations.setSandboxWorkdir);
  const listWorkspaceDir = useAction(
    api.node_only.sandbox.workspace_files.listWorkspaceDir,
  );

  const current = meta?.sandboxWorkdir ?? '';
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
        setDraft(current);
        setError(null);
      }
    },
    [current],
  );

  const persist = useCallback(
    async (rel: string) => {
      if (!threadId) return;
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
            console.warn('[workdir-chip] existence probe failed:', probeErr);
          }
        }
      } catch (err) {
        console.error('[workdir-chip] save failed', err);
        toast({ title: t('workdir.saveFailed'), variant: 'destructive' });
      } finally {
        setSaving(false);
      }
    },
    [threadId, setWorkdir, listWorkspaceDir, toast, t],
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

  if (!threadId) return null;
  // The thread's bound agent wins over the global per-user selection — same
  // rationale as the Plan/Act toggle.
  const active = lockedAgent
    ? lockedAgent
    : selectedAgent
      ? agents?.find((a) => a.name === selectedAgent.name)
      : undefined;
  if (active?.primaryBehavior !== 'external-agent') return null;

  const isCustom = current !== '';
  const chipLabel = isCustom ? current : t('workdir.rootLabel');

  return (
    <Popover
      open={open}
      onOpenChange={handleOpenChange}
      align="start"
      side="top"
      contentClassName="w-80 max-w-80 p-3"
      trigger={
        <Tooltip content={t('workdir.chipTooltip')} side="top">
          <button
            type="button"
            disabled={disabled}
            aria-label={`${t('workdir.label')}: ${chipLabel}`}
            className={cn(
              'border-border bg-muted/40 flex h-8 items-center gap-1 rounded-full border px-2.5 text-xs font-medium transition-colors',
              isCustom
                ? 'text-primary'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Folder className="size-3.5" />
            <span className="max-w-32 truncate font-mono">{chipLabel}</span>
          </button>
        </Tooltip>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          handleSave();
        }}
        className="flex flex-col gap-2"
      >
        <label htmlFor={inputId} className="text-xs font-medium">
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
          className="h-8 font-mono text-xs"
          autoComplete="off"
          spellCheck={false}
        />
        {error !== null ? (
          <p role="alert" className="text-destructive text-xs">
            {error}
          </p>
        ) : (
          <p className="text-muted-foreground text-xs">{t('workdir.helper')}</p>
        )}
        <Row gap={2} className="justify-end">
          {isCustom && (
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
          <Button type="submit" size="sm" disabled={saving}>
            {t('workdir.save')}
          </Button>
        </Row>
      </form>
    </Popover>
  );
}
