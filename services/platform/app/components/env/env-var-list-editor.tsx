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

import { useRegisterDirtySource } from '@/app/components/ui/editor/use-dirty-source';
import { Select } from '@/app/components/ui/forms/select';
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
  /** Set ⇒ this row is a token-source binding (the value is a rotating pool). */
  tokenSourceSlug?: string;
}

/** A selectable token source for the per-row binding dropdown. */
export interface TokenSourceOption {
  slug: string;
  displayName: string;
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
  /** Set ⇒ this row binds a token source; value/secret are ignored on save. */
  tokenSourceSlug?: string;
}

export interface EnvVarListEditorProps {
  rows: readonly LoadedEnvVar[] | undefined;
  isLoading: boolean;
  /** Disable while a parent operation is in flight. */
  disabled?: boolean;
  /** When provided, each row gains a token-source dropdown — picking one turns
   *  the row into a binding (its env var is filled from a rotating broker pool).
   *  Omitted on surfaces that don't support token sources (no behavior change). */
  tokenSources?: readonly TokenSourceOption[];
  onSet: (args: {
    key: string;
    value: string;
    isSecret: boolean;
    tokenSourceSlug?: string;
  }) => Promise<void>;
  onDelete: (key: string) => Promise<void>;
}

function toRow(r: LoadedEnvVar): Row {
  // A token-source binding carries no literal value — the dropdown shows the
  // bound source; the value field is suppressed.
  if (r.tokenSourceSlug !== undefined) {
    return {
      key: r.key,
      value: '',
      isSecret: true,
      existingKey: r.key,
      secretDirty: false,
      masked: false,
      maskedDisplay: '',
      tokenSourceSlug: r.tokenSourceSlug,
    };
  }
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
  tokenSources,
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
  // Re-rendering dirty flag that drives the Save button + the navigation
  // blocker. Distinct from the `dirty` ref above: the ref guards the
  // server-reload snapshot and is set on ANY interaction (including the mask
  // focus/blur display toggles); this state flips true only on a real, savable
  // edit, so merely focusing a stored secret never enables Save or arms the
  // blocker.
  const [isDirty, setIsDirty] = useState(false);
  // Keys present at the last snapshot — the delete set is computed against THIS,
  // not the current rows (a removed row is gone from `localRows`).
  const loadedKeys = useRef(new Set<string>());

  // Warn on navigation away while env edits are unsaved; clears once `isDirty`
  // flips false after a successful save. No-ops gracefully outside a
  // DirtyBlockerProvider (e.g. a dialog surface).
  useRegisterDirtySource(isDirty);

  // Snapshot the query into editable local state whenever it changes AND the
  // user has no pending edits.
  useEffect(() => {
    if (isLoading || rows === undefined || dirty.current) return;
    const loaded = rows.map(toRow);
    loadedKeys.current = new Set(loaded.map((r) => r.key));
    setLocalRows(loaded);
  }, [rows, isLoading]);

  // A real, savable edit: guards the snapshot AND enables Save / arms the blocker.
  const markDirty = (): void => {
    dirty.current = true;
    setIsDirty(true);
  };
  const patch = (i: number, p: Partial<Row>): void => {
    markDirty();
    setLocalRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));
  };
  // Display-only row mutation: a stored secret's mask preview toggling on
  // focus/blur. Guards the snapshot like a real edit, but must NOT mark the form
  // dirty — the mask is never saved, so focusing a secret can't enable Save.
  const patchDisplay = (i: number, p: Partial<Row>): void => {
    dirty.current = true;
    setLocalRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));
  };
  const addRow = (): void => {
    markDirty();
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
    markDirty();
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
        // A token-source binding: re-save whenever the bound slug changed (or
        // it's new); value/secret are ignored server-side for a binding.
        if (r.tokenSourceSlug !== undefined) {
          await onSet({
            key,
            value: '',
            isSecret: true,
            tokenSourceSlug: r.tokenSourceSlug,
          });
          continue;
        }
        if (r.isSecret && !r.secretDirty && r.existingKey === key) continue;
        await onSet({ key, value: r.value, isSecret: r.isSecret });
      }
      // Drop the dirty guard so the reactive query re-snapshots with the
      // freshly-computed secret previews (secrets are write-only — only the
      // server can produce them).
      dirty.current = false;
      setIsDirty(false);
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
      {localRows.map((r, i) => {
        const isBinding = r.tokenSourceSlug !== undefined;
        // When the surface supports token sources, a single per-row "type"
        // chooser (Value / Secret / a source) replaces the Secret checkbox —
        // the user picks ONE: type a value, or draw from a rotating pool. The
        // value field shows only for Value/Secret. Surfaces without sources keep
        // the plain value + Secret-checkbox layout.
        const hasSources =
          tokenSources !== undefined && tokenSources.length > 0;
        const rowType = isBinding
          ? 'token-source'
          : r.isSecret
            ? 'secret'
            : 'value';
        const onTypeChange = (v: string): void => {
          if (!v) return; // ignore Radix's spurious '' during flux
          if (v === 'value') {
            patch(i, {
              isSecret: false,
              tokenSourceSlug: undefined,
              masked: false,
              ...(r.isSecret && { secretDirty: true, value: '' }),
            });
          } else if (v === 'secret') {
            patch(i, {
              isSecret: true,
              secretDirty: true,
              tokenSourceSlug: undefined,
              ...(r.masked && { value: '', masked: false }),
            });
          } else if (v === 'token-source') {
            // Default to the first source; the second dropdown lets the user
            // change it. (Only reachable when hasSources, so [0] exists.)
            const firstSlug = tokenSources?.[0]?.slug;
            if (firstSlug !== undefined) {
              patch(i, {
                tokenSourceSlug: firstSlug,
                isSecret: true,
                value: '',
                masked: false,
                secretDirty: false,
              });
            }
          }
        };
        return (
          <HStack key={i} gap={2} className="items-center">
            <Input
              placeholder={t('keyPlaceholder')}
              value={r.key}
              disabled={busy}
              className="font-mono"
              onChange={(e) => patch(i, { key: e.target.value })}
            />
            {hasSources && (
              <Select
                aria-label={t('valueType')}
                className="w-40 shrink-0"
                disabled={busy}
                value={rowType}
                options={[
                  { value: 'value', label: t('typeValue') },
                  { value: 'secret', label: t('secret') },
                  { value: 'token-source', label: t('typeTokenSource') },
                ]}
                onValueChange={onTypeChange}
              />
            )}
            {isBinding ? (
              // Second dropdown: WHICH token source (shown only once the type is
              // "Token source"). Keeps sources out of the type list.
              <Select
                aria-label={t('typeTokenSource')}
                className="flex-1"
                disabled={busy}
                value={r.tokenSourceSlug ?? ''}
                options={(tokenSources ?? []).map((s) => ({
                  value: s.slug,
                  label: s.displayName,
                }))}
                onValueChange={(v) => {
                  if (v) patch(i, { tokenSourceSlug: v });
                }}
              />
            ) : (
              <Input
                type={r.isSecret && !r.masked ? 'password' : 'text'}
                placeholder={t('valuePlaceholder')}
                value={r.value}
                disabled={busy}
                className="font-mono"
                onFocus={() => {
                  if (r.masked) patchDisplay(i, { value: '', masked: false });
                }}
                onChange={(e) =>
                  patch(i, {
                    value: e.target.value,
                    masked: false,
                    ...(r.isSecret && { secretDirty: true }),
                  })
                }
                onBlur={() => {
                  if (
                    r.isSecret &&
                    r.existingKey !== null &&
                    !r.secretDirty &&
                    r.value === ''
                  ) {
                    patchDisplay(i, { value: r.maskedDisplay, masked: true });
                  }
                }}
              />
            )}
            {!hasSources && (
              <label className="text-muted-foreground flex shrink-0 items-center gap-1.5 text-xs">
                <Checkbox
                  checked={r.isSecret}
                  disabled={busy}
                  onCheckedChange={(c) =>
                    patch(i, {
                      isSecret: c === true,
                      secretDirty: true,
                      ...(r.masked && { value: '', masked: false }),
                    })
                  }
                />
                {t('secret')}
              </label>
            )}
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
        );
      })}
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
        <Button onClick={() => void onSave()} disabled={busy || !isDirty}>
          {saving ? t('saving') : t('save')}
        </Button>
      </HStack>
    </VStack>
  );
}
