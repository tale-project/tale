'use client';

/**
 * Inline editor for an agent's env + secrets, on the automation page (no navigation).
 * Backed by the per-agent `agentEnv` table (mirrors the session sandbox's
 * user-env): plain vars store plaintext, secrets are encrypted at rest and
 * write-only (shown masked, re-typed to change), and everything is decrypted +
 * injected at the agent's external-run claim. Reads via the allowlisted
 * `listAgentEnv` query; writes via `setAgentEnvVar` (encrypts secrets) +
 * `deleteAgentEnvVar`.
 */
import { Button } from '@tale/ui/button';
import { Checkbox } from '@tale/ui/checkbox';
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
import { useBoundQuery } from '../../hooks/use-bound-query';

export interface AgentEnvDialogProps {
  agentSlug: string | null;
  displayName: string;
  onClose: () => void;
}

const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

interface Row {
  key: string;
  value: string;
  isSecret: boolean;
  /** The key as loaded (null = new row) — drives rename/delete diffing. */
  existingKey: string | null;
  /** A secret row whose value the user re-typed this session (so we re-encrypt). */
  secretDirty: boolean;
}

function loadedRow(r: Record<string, unknown>): Row {
  const isSecret = r.isSecret === true;
  const key = typeof r.key === 'string' ? r.key : '';
  return {
    key,
    value: !isSecret && typeof r.value === 'string' ? r.value : '',
    isSecret,
    existingKey: key,
    secretDirty: false,
  };
}

/** The editor body — mounted only while the dialog is open, so the bound query
 *  subscribes only then. */
function EnvEditor({
  agentSlug,
  displayName,
  onClose,
}: {
  agentSlug: string;
  displayName: string;
  onClose: () => void;
}) {
  const { t } = useT('automations');
  const { data, isLoading } = useBoundQuery('agents/agent_env:listAgentEnv', {
    organizationId: '$orgId',
    agentSlug,
  });
  const set = useBoundAction(
    'agents/agent_env_actions:setAgentEnvVar',
    'action',
  );
  const del = useBoundAction('agents/agent_env:deleteAgentEnvVar', 'mutation');
  const setRef = useRef(set);
  setRef.current = set;
  const delRef = useRef(del);
  delRef.current = del;

  const [rows, setRows] = useState<Row[]>([]);
  const [saving, setSaving] = useState(false);
  // Drives the Save button: stays disabled until the user actually edits a row,
  // so Save isn't clickable with zero changes. The dialog closes on a
  // successful save, so there's nothing to reset.
  const [isDirty, setIsDirty] = useState(false);
  const initialized = useRef(false);
  // Keys present at load — the delete set is computed against THIS, not the
  // current rows (a removed row is gone from `rows`, so it must be remembered
  // here to actually delete it on save).
  const loadedKeys = useRef(new Set<string>());

  // Snapshot the query into editable local state once (further reactive updates
  // must not clobber in-flight edits; the dialog closes on save).
  useEffect(() => {
    if (initialized.current || isLoading || data === undefined) return;
    initialized.current = true;
    const loaded = Array.isArray(data)
      ? data.filter(isRecord).map(loadedRow)
      : [];
    loadedKeys.current = new Set(loaded.map((r) => r.key));
    setRows(loaded);
  }, [data, isLoading]);

  const patch = (i: number, p: Partial<Row>): void => {
    setIsDirty(true);
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));
  };
  const addRow = (): void => {
    setIsDirty(true);
    setRows((rs) => [
      ...rs,
      {
        key: '',
        value: '',
        isSecret: false,
        existingKey: null,
        secretDirty: false,
      },
    ]);
  };
  const removeRow = (i: number): void => {
    setIsDirty(true);
    setRows((rs) => rs.filter((_, j) => j !== i));
  };

  const onSave = async (): Promise<void> => {
    const active = rows.filter((r) => r.key.trim() !== '');
    const keys = active.map((r) => r.key.trim());
    for (const k of keys) {
      if (!ENV_KEY_RE.test(k)) {
        toast({ title: t('agents.env.badKey', { key: k }) });
        return;
      }
    }
    if (new Set(keys).size !== keys.length) {
      toast({ title: t('agents.env.dupKey') });
      return;
    }

    setSaving(true);
    try {
      // Delete rows that were loaded but are now gone or renamed away. Computed
      // against the load-time key set so a fully-removed row is still deleted.
      const current = new Set(keys);
      for (const key of loadedKeys.current) {
        if (!current.has(key)) {
          await delRef.current.dispatch({
            organizationId: '$orgId',
            agentSlug,
            key,
          });
        }
      }
      // Upsert each active row — skip a secret that wasn't re-typed and kept its
      // name (its ciphertext stays untouched).
      for (const r of active) {
        const key = r.key.trim();
        if (r.isSecret && !r.secretDirty && r.existingKey === key) continue;
        await setRef.current.dispatch({
          organizationId: '$orgId',
          agentSlug,
          key,
          value: r.value,
          isSecret: r.isSecret,
        });
      }
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
    <VStack gap={4}>
      <VStack gap={1}>
        <ResponsiveDialogTitle>
          {t('agents.env.title', { name: displayName })}
        </ResponsiveDialogTitle>
        <ResponsiveDialogDescription>
          {t('agents.env.description')}
        </ResponsiveDialogDescription>
      </VStack>

      {isLoading && rows.length === 0 ? (
        <SkeletonText lines={4} />
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
                onChange={(e) => patch(i, { key: e.target.value })}
              />
              <Input
                type={r.isSecret ? 'password' : 'text'}
                placeholder={
                  r.isSecret && r.existingKey !== null && !r.secretDirty
                    ? t('agents.env.secretKept')
                    : t('agents.env.valuePlaceholder')
                }
                value={r.value}
                disabled={saving}
                className="font-mono"
                onChange={(e) =>
                  patch(i, {
                    value: e.target.value,
                    ...(r.isSecret && { secretDirty: true }),
                  })
                }
              />
              <label className="text-muted-foreground flex shrink-0 items-center gap-1.5 text-xs">
                <Checkbox
                  checked={r.isSecret}
                  disabled={saving}
                  onCheckedChange={(c) =>
                    patch(i, { isSecret: c === true, secretDirty: true })
                  }
                />
                {t('agents.env.secret')}
              </label>
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
        <Button onClick={() => void onSave()} disabled={saving || !isDirty}>
          {saving ? t('agents.env.saving') : t('agents.env.save')}
        </Button>
      </HStack>
    </VStack>
  );
}

export function AgentEnvDialog({
  agentSlug,
  displayName,
  onClose,
}: AgentEnvDialogProps) {
  const { t } = useT('automations');
  return (
    <ResponsiveDialog
      open={agentSlug !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ResponsiveDialogContent className="max-w-xl">
        {agentSlug === null ? (
          // Title is required for a11y even in the (unrendered) closed state.
          <ResponsiveDialogTitle className="sr-only">
            {t('agents.env.title', { name: '' })}
          </ResponsiveDialogTitle>
        ) : (
          <EnvEditor
            key={agentSlug}
            agentSlug={agentSlug}
            displayName={displayName}
            onClose={onClose}
          />
        )}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
