'use client';

/**
 * Settings → Token Sources: a DataTable of the org's token sources with a
 * right-anchored side panel for create/edit (mirrors the AI Providers page).
 * The broker secret is write-only — never returned; on edit, leaving it blank
 * keeps the stored one. Saving invalidates the same configKeys.list cache the
 * per-agent Environment-tab Type→Source dropdown reads, so a new source shows
 * up there immediately.
 */

import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { DropdownMenu, type DropdownMenuGroup } from '@tale/ui/dropdown-menu';
import { IconButton } from '@tale/ui/icon-button';
import { HStack, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { useQueryClient } from '@tanstack/react-query';
import type { ColumnDef, Row } from '@tanstack/react-table';
import { Ellipsis, Pencil, Plus, Trash2, Variable, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { ACTIONS_COLUMN_SIZE } from '@/app/components/ui/data-table/column-builders';
import { DataTable } from '@/app/components/ui/data-table/data-table';
import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { Input } from '@/app/components/ui/forms/input';
import { Select } from '@/app/components/ui/forms/select';
import { Sheet } from '@/app/components/ui/overlays/sheet';
import { readConvexErrorData } from '@/app/features/settings/providers/utils/error-dispatch';
import { configKeys } from '@/app/hooks/config-query-keys';
import { useActionQuery } from '@/app/hooks/use-action-query';
import { useConvexAction } from '@/app/hooks/use-convex-action';
import { useListPage } from '@/app/hooks/use-list-page';
import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
import { narrowStringUnion } from '@/lib/utils/type-utils';

type AuthMethod = 'none' | 'bearer' | 'header';
type Selection = 'random' | 'round-robin' | 'first';

interface TokenSourceRow {
  slug: string;
  displayName: string;
  endpoint: string;
  targetEnvVar: string;
}

interface FormState {
  existingSlug: string | null;
  hasSecret: boolean;
  slug: string;
  displayName: string;
  endpoint: string;
  method: 'GET' | 'POST';
  authMethod: AuthMethod;
  headerName: string;
  secret: string;
  tokensPath: string;
  tokenField: string;
  statusField: string;
  statusActiveValue: string;
  expiryField: string;
  targetEnvVar: string;
  selection: Selection;
}

function emptyForm(): FormState {
  return {
    existingSlug: null,
    hasSecret: false,
    slug: '',
    displayName: '',
    endpoint: '',
    method: 'GET',
    authMethod: 'bearer',
    headerName: '',
    secret: '',
    tokensPath: '$.tokens',
    tokenField: 'access_token',
    statusField: '',
    statusActiveValue: '',
    expiryField: '',
    targetEnvVar: 'CLAUDE_CODE_OAUTH_TOKEN',
    selection: 'random',
  };
}

interface LoadedTokenSource {
  config: {
    slug: string;
    displayName: string;
    endpoint: string;
    method?: 'GET' | 'POST';
    auth?: { method: AuthMethod; headerName?: string };
    responseMapping: {
      tokensPath: string;
      tokenField: string;
      statusField?: string;
      statusActiveValue?: string;
      expiryField?: string;
    };
    targetEnvVar: string;
    selection?: Selection;
  };
  hasSecret: boolean;
}

/**
 * Map a `VALIDATION_ERROR` ConvexError's `fieldErrors` (a Zod `flatten()`
 * shape) into a flat record of joined per-field messages keyed by the config
 * field name (`slug`, `displayName`, `endpoint`, …). Returns undefined for any
 * other error so the caller falls back to a clean generic toast rather than
 * leaking the raw ConvexError JSON + request id.
 */
function readTokenSourceFieldErrors(
  err: unknown,
): Record<string, string> | undefined {
  const data = readConvexErrorData(err);
  if (data?.code !== 'VALIDATION_ERROR') return undefined;
  const raw = data.fieldErrors;
  if (raw == null || typeof raw !== 'object') return undefined;
  const out: Record<string, string> = {};
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- `raw` is runtime-checked to be a non-null object above; entries are narrowed per-field below
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue;
    const msg = value
      .filter((m): m is string => typeof m === 'string')
      .join('; ');
    if (msg) out[key] = msg;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function fromConfig(res: LoadedTokenSource): FormState {
  const c = res.config;
  return {
    existingSlug: c.slug,
    hasSecret: res.hasSecret,
    slug: c.slug,
    displayName: c.displayName,
    endpoint: c.endpoint,
    method: c.method ?? 'GET',
    authMethod: c.auth?.method ?? 'none',
    headerName: c.auth?.headerName ?? '',
    secret: '',
    tokensPath: c.responseMapping.tokensPath,
    tokenField: c.responseMapping.tokenField,
    statusField: c.responseMapping.statusField ?? '',
    statusActiveValue: c.responseMapping.statusActiveValue ?? '',
    expiryField: c.responseMapping.expiryField ?? '',
    targetEnvVar: c.targetEnvVar,
    selection: c.selection ?? 'random',
  };
}

export function TokenSourcesManager({
  organizationId,
}: {
  organizationId: string;
}) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');
  const queryClient = useQueryClient();
  const listKey = configKeys.list('token-sources', organizationId);

  const { data: sources, isLoading } = useActionQuery(
    listKey,
    api.token_sources.file_actions.listTokenSources,
    { organizationId },
    { enabled: !!organizationId },
  );
  const { mutateAsync: deleteSource, isPending: deleting } = useConvexAction(
    api.token_sources.file_actions.deleteTokenSource,
  );

  // null = closed; { slug: null } = create; { slug } = edit.
  const [panel, setPanel] = useState<{ slug: string | null } | null>(null);
  const [deleteRow, setDeleteRow] = useState<TokenSourceRow | null>(null);

  const rows = useMemo<TokenSourceRow[]>(() => sources ?? [], [sources]);

  const invalidate = useCallback(async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: listKey });
  }, [queryClient, listKey]);

  const handleDelete = useCallback(async (): Promise<void> => {
    if (!deleteRow) return;
    try {
      await deleteSource({ organizationId, slug: deleteRow.slug });
      toast({ title: t('tokenSources.deleted'), variant: 'success' });
      setDeleteRow(null);
      await invalidate();
    } catch (err) {
      toast({
        title: t('tokenSources.saveError'),
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      });
    }
  }, [deleteRow, deleteSource, organizationId, t, invalidate]);

  const columns = useMemo<ColumnDef<TokenSourceRow>[]>(
    () => [
      {
        id: 'displayName',
        header: t('tokenSources.displayName'),
        cell: ({ row }) => (
          <Text as="span" variant="label">
            {row.original.displayName}
          </Text>
        ),
      },
      {
        id: 'endpoint',
        header: t('tokenSources.endpoint'),
        cell: ({ row }) => (
          <Text
            as="span"
            variant="muted"
            className="block max-w-[320px] truncate font-mono text-xs"
          >
            {row.original.endpoint}
          </Text>
        ),
      },
      {
        id: 'targetEnvVar',
        header: t('tokenSources.targetEnvVar'),
        cell: ({ row }) => (
          <Text as="span" variant="muted" className="font-mono text-xs">
            {row.original.targetEnvVar}
          </Text>
        ),
      },
    ],
    [t],
  );

  const columnsWithActions = useMemo<ColumnDef<TokenSourceRow>[]>(
    () => [
      ...columns,
      {
        id: 'actions',
        size: ACTIONS_COLUMN_SIZE,
        cell: ({ row }: { row: Row<TokenSourceRow> }) => (
          <TokenSourceRowActions
            onEdit={() => setPanel({ slug: row.original.slug })}
            onDelete={() => setDeleteRow(row.original)}
          />
        ),
      },
    ],
    [columns],
  );

  const list = useListPage<TokenSourceRow>({
    dataSource: { type: 'query', data: isLoading ? undefined : rows },
    pageSize: 50,
    entityLabel: t('tokenSources.entityLabel'),
  });

  return (
    <>
      <DataTable
        {...list.tableProps}
        columns={columnsWithActions}
        getRowId={(row) => row.slug}
        onRowClick={(row) => setPanel({ slug: row.original.slug })}
        actionMenu={
          <Button onClick={() => setPanel({ slug: null })}>
            <Plus className="mr-1.5 size-4" />
            {t('tokenSources.new')}
          </Button>
        }
        emptyState={{
          icon: Variable,
          title: t('tokenSources.emptyTitle'),
          description: t('tokenSources.empty'),
        }}
      />

      <ConfirmDialog
        open={deleteRow != null}
        onOpenChange={(open) => {
          if (!open) setDeleteRow(null);
        }}
        title={t('tokenSources.deleteTitle')}
        description={t('tokenSources.deleteConfirm', {
          name: deleteRow?.displayName ?? '',
        })}
        variant="destructive"
        confirmText={t('tokenSources.delete')}
        loadingText={tCommon('actions.deleting')}
        isLoading={deleting}
        onConfirm={() => void handleDelete()}
      />

      {panel && (
        <TokenSourceFormSheet
          organizationId={organizationId}
          editSlug={panel.slug}
          onOpenChange={(open) => {
            if (!open) setPanel(null);
          }}
          onSaved={() => {
            setPanel(null);
            void invalidate();
          }}
        />
      )}
    </>
  );
}

function TokenSourceRowActions({
  onEdit,
  onDelete,
}: {
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useT('settings');
  const items = useMemo<DropdownMenuGroup[]>(
    () => [
      [
        {
          type: 'item',
          label: t('tokenSources.edit'),
          icon: Pencil,
          onClick: onEdit,
        },
      ],
      [
        {
          type: 'item',
          label: t('tokenSources.delete'),
          icon: Trash2,
          onClick: onDelete,
          destructive: true,
        },
      ],
    ],
    [t, onEdit, onDelete],
  );
  return (
    <DropdownMenu
      trigger={
        <IconButton
          icon={Ellipsis}
          aria-label={t('tokenSources.actions')}
          className="text-muted-foreground size-8"
          onClick={(e) => e.stopPropagation()}
        />
      }
      items={items}
      align="end"
    />
  );
}

/**
 * Right-anchored create/edit panel. On edit it loads the source's config via
 * the `detail` query (the broker secret is never returned — `hasSecret` only
 * drives the placeholder); leaving the secret field blank on save keeps the
 * stored one.
 */
function TokenSourceFormSheet({
  organizationId,
  editSlug,
  onOpenChange,
  onSaved,
}: {
  organizationId: string;
  editSlug: string | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');

  const { data: detail } = useActionQuery(
    configKeys.detail('token-sources', organizationId, editSlug ?? ''),
    api.token_sources.file_actions.getTokenSource,
    { organizationId, slug: editSlug ?? '' },
    { enabled: !!editSlug },
  );

  const { mutateAsync: saveSource, isPending: saving } = useConvexAction(
    api.token_sources.file_actions.saveTokenSource,
  );

  const [form, setForm] = useState(editSlug ? null : emptyForm());
  // Server-side per-field validation errors, keyed by config field name. Each
  // edited field clears its own error so the inline message can't go stale.
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const set = (p: Partial<FormState>): void => {
    setForm((f) => (f ? { ...f, ...p } : f));
    setFieldErrors((prev) => {
      const keys = Object.keys(p);
      if (!keys.some((k) => k in prev)) return prev;
      const next = { ...prev };
      for (const k of keys) delete next[k];
      return next;
    });
  };

  // Populate from the detail query the first time it resolves for this slug;
  // never clobber in-progress edits (guarded on `existingSlug`).
  useEffect(() => {
    if (!editSlug || !detail) return;
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- getTokenSource returns the validated config as v.any()
    const loaded = detail as LoadedTokenSource;
    setForm((f) =>
      f && f.existingSlug === loaded.config.slug ? f : fromConfig(loaded),
    );
  }, [editSlug, detail]);

  const onSave = async (): Promise<void> => {
    if (!form) return;
    setFieldErrors({});
    const auth =
      form.authMethod === 'none'
        ? { method: 'none' as const }
        : form.authMethod === 'bearer'
          ? { method: 'bearer' as const }
          : { method: 'header' as const, headerName: form.headerName.trim() };
    const responseMapping = {
      tokensPath: form.tokensPath.trim(),
      tokenField: form.tokenField.trim(),
      ...(form.statusField.trim() && { statusField: form.statusField.trim() }),
      ...(form.statusActiveValue.trim() && {
        statusActiveValue: form.statusActiveValue.trim(),
      }),
      ...(form.expiryField.trim() && { expiryField: form.expiryField.trim() }),
    };
    const config = {
      slug: form.slug.trim(),
      displayName: form.displayName.trim(),
      endpoint: form.endpoint.trim(),
      method: form.method,
      auth,
      responseMapping,
      targetEnvVar: form.targetEnvVar.trim(),
      selection: form.selection,
    };
    try {
      await saveSource({
        organizationId,
        config,
        // Only send the secret when the user entered one (blank on edit keeps
        // the stored secret untouched).
        ...(form.secret.length > 0 && { secret: form.secret }),
      });
      toast({ title: t('tokenSources.saved'), variant: 'success' });
      onSaved();
    } catch (err) {
      // Prefer inline per-field errors from the server's VALIDATION_ERROR; the
      // raw ConvexError message is a JSON blob with a request id, so it must
      // never reach the toast. Anything else gets a clean generic message.
      const mapped = readTokenSourceFieldErrors(err);
      if (mapped) {
        setFieldErrors(mapped);
        toast({
          title: t('tokenSources.saveError'),
          description: tCommon('editor.fixHighlightedFields'),
          variant: 'destructive',
        });
        return;
      }
      toast({
        title: t('tokenSources.saveError'),
        description: tCommon('errors.generic'),
        variant: 'destructive',
      });
    }
  };

  const title = editSlug
    ? t('tokenSources.editTitle')
    : t('tokenSources.newTitle');
  const needsSecret = form ? form.authMethod !== 'none' : false;

  return (
    <Sheet
      open
      onOpenChange={onOpenChange}
      title={title}
      size="md"
      resize={{ storageKey: 'token-source-panel-width' }}
      hideClose
      className="flex flex-col gap-0 overflow-hidden p-0"
    >
      <HStack
        justify="between"
        align="center"
        className="border-border shrink-0 border-b p-4 sm:px-6 sm:py-4"
      >
        <Text variant="label" className="text-base font-semibold">
          {title}
        </Text>
        <IconButton
          icon={X}
          aria-label={tCommon('aria.close')}
          variant="ghost"
          onClick={() => onOpenChange(false)}
        />
      </HStack>

      <div className="flex-1 overflow-y-auto p-4 sm:px-6 sm:py-5">
        {form ? (
          <Stack gap={4}>
            <Input
              label={t('tokenSources.slug')}
              value={form.slug}
              disabled={form.existingSlug !== null || saving}
              placeholder="coolai"
              className="font-mono"
              errorMessage={fieldErrors.slug}
              onChange={(e) => set({ slug: e.target.value })}
            />
            <Input
              label={t('tokenSources.displayName')}
              value={form.displayName}
              disabled={saving}
              errorMessage={fieldErrors.displayName}
              onChange={(e) => set({ displayName: e.target.value })}
            />
            <Input
              label={t('tokenSources.endpoint')}
              value={form.endpoint}
              disabled={saving}
              placeholder="https://broker.example.com/api/tokens"
              className="font-mono"
              errorMessage={fieldErrors.endpoint}
              onChange={(e) => set({ endpoint: e.target.value })}
            />

            <Select
              label={t('tokenSources.method')}
              value={form.method}
              disabled={saving}
              options={[
                { value: 'GET', label: 'GET' },
                { value: 'POST', label: 'POST' },
              ]}
              onValueChange={(v) => {
                const m = narrowStringUnion<'GET' | 'POST'>(v, ['GET', 'POST']);
                if (m) set({ method: m });
              }}
            />

            <Select
              label={t('tokenSources.authMethod')}
              value={form.authMethod}
              disabled={saving}
              options={[
                { value: 'none', label: t('tokenSources.authNone') },
                { value: 'bearer', label: t('tokenSources.authBearer') },
                { value: 'header', label: t('tokenSources.authHeader') },
              ]}
              onValueChange={(v) => {
                const m = narrowStringUnion<AuthMethod>(v, [
                  'none',
                  'bearer',
                  'header',
                ]);
                if (m) set({ authMethod: m });
              }}
            />
            {form.authMethod === 'header' && (
              <Input
                label={t('tokenSources.headerName')}
                value={form.headerName}
                disabled={saving}
                placeholder="X-Api-Key"
                className="font-mono"
                errorMessage={fieldErrors.auth}
                onChange={(e) => set({ headerName: e.target.value })}
              />
            )}
            {needsSecret && (
              <Stack gap={2}>
                {form.hasSecret && (
                  <HStack gap={3} align="center" className="flex-wrap">
                    <Badge variant="green" dot>
                      {t('tokenSources.secretConfigured')}
                    </Badge>
                    <Text className="text-muted-foreground font-mono text-sm">
                      ••••••••••
                    </Text>
                  </HStack>
                )}
                <Input
                  label={
                    form.hasSecret
                      ? t('tokenSources.secretReplace')
                      : t('tokenSources.secret')
                  }
                  type="password"
                  value={form.secret}
                  disabled={saving}
                  placeholder={
                    form.hasSecret
                      ? t('tokenSources.secretSetPlaceholder')
                      : t('tokenSources.secretPlaceholder')
                  }
                  className="font-mono"
                  onChange={(e) => set({ secret: e.target.value })}
                />
              </Stack>
            )}

            <Text variant="muted" className="text-xs">
              {t('tokenSources.mappingHint')}
            </Text>
            <Input
              label={t('tokenSources.tokensPath')}
              value={form.tokensPath}
              disabled={saving}
              placeholder="$.tokens"
              className="font-mono"
              onChange={(e) => set({ tokensPath: e.target.value })}
            />
            <Input
              label={t('tokenSources.tokenField')}
              value={form.tokenField}
              disabled={saving}
              placeholder="access_token"
              className="font-mono"
              onChange={(e) => set({ tokenField: e.target.value })}
            />
            <Input
              label={t('tokenSources.statusField')}
              value={form.statusField}
              disabled={saving}
              placeholder="status"
              className="font-mono"
              onChange={(e) => set({ statusField: e.target.value })}
            />
            <Input
              label={t('tokenSources.statusActiveValue')}
              value={form.statusActiveValue}
              disabled={saving}
              placeholder="active"
              className="font-mono"
              onChange={(e) => set({ statusActiveValue: e.target.value })}
            />
            <Input
              label={t('tokenSources.expiryField')}
              value={form.expiryField}
              disabled={saving}
              placeholder="expires_at"
              className="font-mono"
              onChange={(e) => set({ expiryField: e.target.value })}
            />

            <Input
              label={t('tokenSources.targetEnvVar')}
              value={form.targetEnvVar}
              disabled={saving}
              placeholder="CLAUDE_CODE_OAUTH_TOKEN"
              className="font-mono"
              errorMessage={fieldErrors.targetEnvVar}
              onChange={(e) => set({ targetEnvVar: e.target.value })}
            />
            <Select
              label={t('tokenSources.selection')}
              value={form.selection}
              disabled={saving}
              options={[
                { value: 'random', label: t('tokenSources.selectionRandom') },
                { value: 'first', label: t('tokenSources.selectionFirst') },
              ]}
              onValueChange={(v) => {
                const s = narrowStringUnion<Selection>(v, [
                  'random',
                  'round-robin',
                  'first',
                ]);
                if (s) set({ selection: s });
              }}
            />
          </Stack>
        ) : (
          <Text variant="muted" className="text-sm">
            {tCommon('actions.loading')}
          </Text>
        )}
      </div>

      <HStack
        gap={2}
        justify="end"
        className="border-border shrink-0 border-t p-4 sm:px-6 sm:py-4"
      >
        <Button
          variant="ghost"
          disabled={saving}
          onClick={() => onOpenChange(false)}
        >
          {t('tokenSources.cancel')}
        </Button>
        <Button disabled={saving || !form} onClick={() => void onSave()}>
          {saving ? t('tokenSources.saving') : t('tokenSources.save')}
        </Button>
      </HStack>
    </Sheet>
  );
}
