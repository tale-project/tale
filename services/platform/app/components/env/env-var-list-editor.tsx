'use client';

/**
 * Presentational, binding-agnostic env/secret list editor. One unified list of
 * KEY = value rows; tick "Secret" to encrypt + mask a row. A stored secret
 * shows a low-leak edge preview (e.g. `sk-••••xyz`) as its value so it reads as
 * "set" — it is write-only, so focusing the field clears it for a clean re-type
 * and blurring an untouched field restores the preview. Owns its local row state
 * + the rename / secret-dirty diffing, then commits via the injected `onSet` /
 * `onDelete` callbacks — so the same component backs the workflow-level,
 * step-level, and per-agent surfaces, each wiring its own store.
 */
import { Button } from '@tale/ui/button';
import { Checkbox } from '@tale/ui/checkbox';
import { Input } from '@tale/ui/input';
import { HStack, VStack } from '@tale/ui/layout';
import { SkeletonText } from '@tale/ui/skeleton';
import { Text } from '@tale/ui/text';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

/** Env var name: letters/digits/underscore, not starting with a digit. */
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Fallback mask shown for a stored secret when the query omits a preview. */
const SECRET_MASK = '••••••••';

/** One loaded row as returned by a `listEnv`-style query (secrets are masked). */
export interface LoadedEnvVar {
  key: string;
  isSecret: boolean;
  value?: string;
  maskedValue?: string;
}

interface Row {
  key: string;
  value: string;
  isSecret: boolean;
  /** The key as loaded (null = new row) — drives rename/delete diffing. */
  existingKey: string | null;
  /** A secret row whose value the user re-typed this session (so we re-encrypt). */
  secretDirty: boolean;
  /** A stored secret currently showing its mask preview as the value — cleared
   *  for editing on focus, restored on blur if untouched. Never saved. */
  masked: boolean;
  /** The stored secret's mask preview, restored on blur. */
  maskedDisplay: string;
}

export interface EnvVarListEditorProps {
  rows: readonly LoadedEnvVar[] | undefined;
  isLoading: boolean;
  /** Disable while a parent operation is in flight. */
  disabled?: boolean;
  onSet: (args: {
    key: string;
    value: string;
    isSecret: boolean;
  }) => Promise<void>;
  onDelete: (key: string) => Promise<void>;
}

function toRow(r: LoadedEnvVar): Row {
  // A stored secret shows its mask preview as the field value so a configured
  // secret reads as "set", not empty. Plain vars show their plaintext.
  if (r.isSecret) {
    const display = r.maskedValue ?? SECRET_MASK;
    return {
      key: r.key,
      value: display,
      isSecret: true,
      existingKey: r.key,
      secretDirty: false,
      masked: true,
      maskedDisplay: display,
    };
  }
  return {
    key: r.key,
    value: typeof r.value === 'string' ? r.value : '',
    isSecret: false,
    existingKey: r.key,
    secretDirty: false,
    masked: false,
    maskedDisplay: '',
  };
}

export function EnvVarListEditor({
  rows,
  isLoading,
  disabled = false,
  onSet,
  onDelete,
}: EnvVarListEditorProps) {
  const { t } = useT('envEditor');

  const [localRows, setLocalRows] = useState<Row[]>([]);
  const [saving, setSaving] = useState(false);
  // While the user has unsaved edits, server (re)loads must not clobber them.
  // After a save we clear this so the post-write reactive update re-snapshots
  // with the freshly-computed secret previews.
  const dirty = useRef(false);
  // Keys present at the last snapshot — the delete set is computed against THIS,
  // not the current rows (a removed row is gone from `localRows`).
  const loadedKeys = useRef(new Set<string>());

  // Snapshot the query into editable local state whenever it changes AND the
  // user has no pending edits.
  useEffect(() => {
    if (isLoading || rows === undefined || dirty.current) return;
    const loaded = rows.map(toRow);
    loadedKeys.current = new Set(loaded.map((r) => r.key));
    setLocalRows(loaded);
  }, [rows, isLoading]);

  const patch = (i: number, p: Partial<Row>): void => {
    dirty.current = true;
    setLocalRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));
  };
  const addRow = (): void => {
    dirty.current = true;
    setLocalRows((rs) => [
      ...rs,
      {
        key: '',
        value: '',
        isSecret: false,
        existingKey: null,
        secretDirty: false,
        masked: false,
        maskedDisplay: '',
      },
    ]);
  };
  const removeRow = (i: number): void => {
    dirty.current = true;
    setLocalRows((rs) => rs.filter((_, j) => j !== i));
  };

  const onSave = async (): Promise<void> => {
    const active = localRows.filter((r) => r.key.trim() !== '');
    const keys = active.map((r) => r.key.trim());
    for (const k of keys) {
      if (!ENV_KEY_RE.test(k)) {
        toast({ title: t('badKey', { key: k }), variant: 'destructive' });
        return;
      }
    }
    if (new Set(keys).size !== keys.length) {
      toast({ title: t('dupKey'), variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      // Delete rows that were loaded but are now gone or renamed away.
      const current = new Set(keys);
      for (const key of loadedKeys.current) {
        if (!current.has(key)) await onDelete(key);
      }
      // Upsert each active row — skip a secret that wasn't re-typed and kept its
      // name (its ciphertext + preview stay untouched).
      for (const r of active) {
        const key = r.key.trim();
        if (r.isSecret && !r.secretDirty && r.existingKey === key) continue;
        await onSet({ key, value: r.value, isSecret: r.isSecret });
      }
      // Drop the dirty guard so the reactive query re-snapshots with the
      // freshly-computed secret previews (secrets are write-only — only the
      // server can produce them).
      dirty.current = false;
      toast({ title: t('saved'), variant: 'success' });
    } catch (err) {
      toast({
        title: t('saveError'),
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const busy = saving || disabled;

  if (isLoading && localRows.length === 0) {
    return <SkeletonText lines={3} />;
  }

  return (
    <VStack gap={2}>
      {localRows.length === 0 && (
        <Text variant="muted" className="text-sm">
          {t('none')}
        </Text>
      )}
      {localRows.map((r, i) => (
        <HStack key={i} gap={2} className="items-center">
          <Input
            placeholder={t('keyPlaceholder')}
            value={r.key}
            disabled={busy}
            className="font-mono"
            onChange={(e) => patch(i, { key: e.target.value })}
          />
          <Input
            type={r.isSecret && !r.masked ? 'password' : 'text'}
            placeholder={t('valuePlaceholder')}
            value={r.value}
            disabled={busy}
            className="font-mono"
            onFocus={() => {
              // Clear the displayed preview so the user types a new secret value
              // on a clean field (the stored secret stays put until they save).
              if (r.masked) patch(i, { value: '', masked: false });
            }}
            onChange={(e) =>
              patch(i, {
                value: e.target.value,
                masked: false,
                ...(r.isSecret && { secretDirty: true }),
              })
            }
            onBlur={() => {
              // Left an untouched stored secret — restore its preview.
              if (
                r.isSecret &&
                r.existingKey !== null &&
                !r.secretDirty &&
                r.value === ''
              ) {
                patch(i, { value: r.maskedDisplay, masked: true });
              }
            }}
          />
          <label className="text-muted-foreground flex shrink-0 items-center gap-1.5 text-xs">
            <Checkbox
              checked={r.isSecret}
              disabled={busy}
              onCheckedChange={(c) =>
                patch(i, {
                  isSecret: c === true,
                  secretDirty: true,
                  // Drop the preview when toggling so its mask never becomes a
                  // plaintext value.
                  ...(r.masked && { value: '', masked: false }),
                })
              }
            />
            {t('secret')}
          </label>
          <Button
            size="icon"
            variant="ghost"
            disabled={busy}
            aria-label={t('remove')}
            onClick={() => removeRow(i)}
          >
            <Trash2 className="size-4" />
          </Button>
        </HStack>
      ))}
      <HStack gap={2} className="justify-between">
        <Button
          variant="ghost"
          disabled={busy}
          className="self-start"
          onClick={addRow}
        >
          <Plus className="size-4" />
          {t('add')}
        </Button>
        <Button onClick={() => void onSave()} disabled={busy}>
          {saving ? t('saving') : t('save')}
        </Button>
      </HStack>
    </VStack>
  );
}
