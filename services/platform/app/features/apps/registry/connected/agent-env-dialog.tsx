'use client';

/**
 * Inline editor for an agent's plain (non-secret) env vars — key/value rows on
 * the app page (no navigation). Read/written via the allowlisted readAgent /
 * saveAgent; the env is delivered to the agent's external run and merged into
 * the spawned process by the runtime daemon. NOT for secrets: a BYO agent's
 * real credentials live on the runtime machine, so this is plaintext config.
 */
import { Button } from '@tale/ui/button';
import { Input } from '@tale/ui/input';
import { HStack, VStack } from '@tale/ui/layout';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogTitle,
} from '@tale/ui/responsive-dialog';
import { SkeletonText } from '@tale/ui/skeleton';
import { Text } from '@tale/ui/text';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { isRecord } from '@/lib/utils/type-utils';

import { useBoundAction } from '../../hooks/use-bound-action';

export interface AgentEnvDialogProps {
  agentSlug: string | null;
  displayName: string;
  onClose: () => void;
}

// POSIX env var name — a valid key the daemon can export.
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

interface Row {
  key: string;
  value: string;
}

export function AgentEnvDialog({
  agentSlug,
  displayName,
  onClose,
}: AgentEnvDialogProps) {
  const { t } = useT('apps');
  const read = useBoundAction('agents/file_actions:readAgent', 'action');
  const save = useBoundAction('agents/file_actions:saveAgent', 'action');
  const readRef = useRef(read);
  readRef.current = read;
  const saveRef = useRef(save);
  saveRef.current = save;

  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!agentSlug) return undefined;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setConfig(null);
    setRows([]);
    void (async () => {
      try {
        const result = await readRef.current.dispatch({
          organizationId: '$orgId',
          agentName: agentSlug,
        });
        if (cancelled) return;
        if (isRecord(result) && result.ok === true && isRecord(result.config)) {
          setConfig(result.config);
          const env = isRecord(result.config.env) ? result.config.env : {};
          setRows(
            Object.entries(env).map(([key, v]) => ({
              key,
              value: typeof v === 'string' ? v : '',
            })),
          );
        } else {
          setError(t('agents.env.loadError'));
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

  const setRow = (i: number, patch: Partial<Row>): void =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRow = (): void => setRows((rs) => [...rs, { key: '', value: '' }]);
  const removeRow = (i: number): void =>
    setRows((rs) => rs.filter((_, j) => j !== i));

  const onSave = async (): Promise<void> => {
    if (!config || !agentSlug) return;
    const env: Record<string, string> = {};
    for (const r of rows) {
      const key = r.key.trim();
      if (key === '') continue;
      if (!ENV_KEY_RE.test(key)) {
        toast({ title: t('agents.env.badKey', { key }) });
        return;
      }
      env[key] = r.value;
    }
    setSaving(true);
    try {
      await saveRef.current.dispatch({
        organizationId: '$orgId',
        agentName: agentSlug,
        config: { ...config, env },
      });
      toast({ title: t('agents.env.saved') });
      onClose();
    } catch (err) {
      toast({
        title: t('agents.env.saveError'),
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <ResponsiveDialog
      open={agentSlug !== null}
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <ResponsiveDialogContent className="max-w-xl">
        <VStack gap={4}>
          <VStack gap={1}>
            <ResponsiveDialogTitle>
              {t('agents.env.title', { name: displayName })}
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              {t('agents.env.description')}
            </ResponsiveDialogDescription>
          </VStack>

          {loading ? (
            <SkeletonText lines={4} />
          ) : error ? (
            <Text variant="error">{error}</Text>
          ) : (
            <VStack gap={2}>
              {rows.length === 0 && (
                <Text variant="muted" className="text-sm">
                  {t('agents.env.none')}
                </Text>
              )}
              {rows.map((r, i) => (
                <HStack key={i} gap={2} className="items-center">
                  <Input
                    placeholder={t('agents.env.keyPlaceholder')}
                    value={r.key}
                    disabled={saving}
                    className="font-mono"
                    onChange={(e) => setRow(i, { key: e.target.value })}
                  />
                  <Input
                    placeholder={t('agents.env.valuePlaceholder')}
                    value={r.value}
                    disabled={saving}
                    className="font-mono"
                    onChange={(e) => setRow(i, { value: e.target.value })}
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    disabled={saving}
                    aria-label={t('agents.env.remove')}
                    onClick={() => removeRow(i)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </HStack>
              ))}
              <Button
                size="sm"
                variant="ghost"
                disabled={saving}
                className="self-start"
                onClick={addRow}
              >
                <Plus className="size-4" />
                {t('agents.env.add')}
              </Button>
            </VStack>
          )}

          <HStack gap={2} className="justify-end">
            <Button variant="ghost" onClick={onClose} disabled={saving}>
              {t('agents.env.cancel')}
            </Button>
            <Button
              onClick={() => void onSave()}
              disabled={loading || saving || error !== null || config === null}
            >
              {saving ? t('agents.env.saving') : t('agents.env.save')}
            </Button>
          </HStack>
        </VStack>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
