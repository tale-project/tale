'use client';

/**
 * Inline editor for an agent's `systemInstructions` — opens as a modal ON the
 * app page (no navigation) so configuring the team stays in one place. Reads
 * the full agent config via the allowlisted `readAgent` action, edits just the
 * instructions, and writes back via `saveAgent` (which re-validates + gates
 * capability-widening changes — an instructions-only edit passes for any member).
 */
import { Button } from '@tale/ui/button';
import { HStack, VStack } from '@tale/ui/layout';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogTitle,
} from '@tale/ui/responsive-dialog';
import { SkeletonText } from '@tale/ui/skeleton';
import { Text } from '@tale/ui/text';
import { Textarea } from '@tale/ui/textarea';
import { useEffect, useRef, useState } from 'react';

import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { isRecord } from '@/lib/utils/type-utils';

import { useBoundAction } from '../../hooks/use-bound-action';

export interface AgentInstructionsDialogProps {
  /** The agent slug to edit, or null when the dialog is closed. */
  agentSlug: string | null;
  /** Friendly name for the dialog title. */
  displayName: string;
  onClose: () => void;
}

export function AgentInstructionsDialog({
  agentSlug,
  displayName,
  onClose,
}: AgentInstructionsDialogProps) {
  const { t } = useT('apps');
  const read = useBoundAction('agents/file_actions:readAgent', 'action');
  const save = useBoundAction('agents/file_actions:saveAgent', 'action');
  const readRef = useRef(read);
  readRef.current = read;
  const saveRef = useRef(save);
  saveRef.current = save;

  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!agentSlug) return undefined;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setConfig(null);
    void (async () => {
      try {
        const result = await readRef.current.dispatch({
          organizationId: '$orgId',
          agentName: agentSlug,
        });
        if (cancelled) return;
        if (isRecord(result) && result.ok === true && isRecord(result.config)) {
          setConfig(result.config);
          setValue(
            typeof result.config.systemInstructions === 'string'
              ? result.config.systemInstructions
              : '',
          );
        } else {
          setError(t('agents.instructions.loadError'));
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agentSlug, t]);

  const onSave = async (): Promise<void> => {
    if (!agentSlug || !config) return;
    setSaving(true);
    try {
      await saveRef.current.dispatch({
        organizationId: '$orgId',
        agentName: agentSlug,
        config: { ...config, systemInstructions: value },
      });
      toast({ title: t('agents.instructions.saved') });
      onClose();
    } catch (err) {
      toast({
        title: t('agents.instructions.saveError'),
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSaving(false);
    }
  };

  // Enable Save only when the text actually differs from what was loaded, so the
  // button greys out with no pending change (and after a save re-reads the same
  // value). Mirrors the load-time normalization of a non-string field to ''.
  const baselineInstructions =
    typeof config?.systemInstructions === 'string'
      ? config.systemInstructions
      : '';
  const isDirty = config !== null && value !== baselineInstructions;

  return (
    <ResponsiveDialog
      open={agentSlug !== null}
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <ResponsiveDialogContent className="max-w-2xl">
        <VStack gap={4}>
          <VStack gap={1}>
            <ResponsiveDialogTitle>
              {t('agents.instructions.title', { name: displayName })}
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              {t('agents.instructions.description')}
            </ResponsiveDialogDescription>
          </VStack>

          {loading ? (
            <SkeletonText lines={6} />
          ) : error ? (
            <Text variant="error">{error}</Text>
          ) : (
            <Textarea
              rows={14}
              value={value}
              disabled={saving}
              onChange={(e) => setValue(e.target.value)}
              placeholder={t('agents.instructions.placeholder')}
            />
          )}

          <HStack gap={2} className="justify-end">
            <Button variant="ghost" onClick={onClose} disabled={saving}>
              {t('agents.instructions.cancel')}
            </Button>
            <Button
              onClick={() => void onSave()}
              disabled={
                loading ||
                saving ||
                error !== null ||
                config === null ||
                !isDirty
              }
            >
              {saving
                ? t('agents.instructions.saving')
                : t('agents.instructions.save')}
            </Button>
          </HStack>
        </VStack>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
