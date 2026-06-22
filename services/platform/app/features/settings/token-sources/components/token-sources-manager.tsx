'use client';

/**
 * Settings → Token Sources: create/edit/delete the org's token sources (an
 * external broker + a response mapping that yields a rotating credential pool).
 * The broker secret is write-only — never returned; on edit, leaving it blank
 * keeps the stored one. Saving invalidates the list AND the per-agent
 * Environment-tab Type→Source dropdown (same configKeys.list cache).
 */

import { Button } from '@tale/ui/button';
import { Input } from '@tale/ui/input';
import { HStack, VStack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { Select } from '@/app/components/ui/forms/select';
import { configKeys } from '@/app/hooks/config-query-keys';
import { useActionQuery } from '@/app/hooks/use-action-query';
import { useConvexAction } from '@/app/hooks/use-convex-action';
import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
import { narrowStringUnion } from '@/lib/utils/type-utils';

type AuthMethod = 'none' | 'bearer' | 'header';
type Selection = 'random' | 'round-robin' | 'first';

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

export function TokenSourcesManager({
  organizationId,
}: {
  organizationId: string;
}) {
  const { t } = useT('settings');
  const queryClient = useQueryClient();
  const listKey = configKeys.list('token-sources', organizationId);

  const { data: sources, isLoading } = useActionQuery(
    listKey,
    api.token_sources.file_actions.listTokenSources,
    { organizationId },
    { enabled: !!organizationId },
  );
  const { mutateAsync: getSource } = useConvexAction(
    api.token_sources.file_actions.getTokenSource,
  );
  const { mutateAsync: saveSource, isPending: saving } = useConvexAction(
    api.token_sources.file_actions.saveTokenSource,
  );
  const { mutateAsync: deleteSource } = useConvexAction(
    api.token_sources.file_actions.deleteTokenSource,
  );

  const [form, setForm] = useState<FormState | null>(null);
  const set = (p: Partial<FormState>): void =>
    setForm((f) => (f ? { ...f, ...p } : f));

  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: listKey });
  };

  const openEdit = async (slug: string): Promise<void> => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- getTokenSource returns the validated config as v.any()
    const res = (await getSource({ organizationId, slug })) as {
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
    } | null;
    if (!res) {
      toast({ title: t('tokenSources.loadError'), variant: 'destructive' });
      return;
    }
    const c = res.config;
    setForm({
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
    });
  };

  const onSave = async (): Promise<void> => {
    if (!form) return;
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
      await refresh();
      setForm(null);
      toast({ title: t('tokenSources.saved'), variant: 'success' });
    } catch (err) {
      toast({
        title: t('tokenSources.saveError'),
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      });
    }
  };

  const onDelete = async (slug: string): Promise<void> => {
    await deleteSource({ organizationId, slug });
    await refresh();
    toast({ title: t('tokenSources.deleted'), variant: 'success' });
  };

  // --- Edit/create form ---------------------------------------------------
  if (form) {
    const needsSecret = form.authMethod !== 'none';
    return (
      <VStack gap={4} className="max-w-2xl">
        <Text className="text-lg font-semibold">
          {form.existingSlug
            ? t('tokenSources.editTitle')
            : t('tokenSources.newTitle')}
        </Text>

        <Field label={t('tokenSources.slug')}>
          <Input
            value={form.slug}
            disabled={form.existingSlug !== null || saving}
            placeholder="coolai"
            className="font-mono"
            onChange={(e) => set({ slug: e.target.value })}
          />
        </Field>
        <Field label={t('tokenSources.displayName')}>
          <Input
            value={form.displayName}
            disabled={saving}
            onChange={(e) => set({ displayName: e.target.value })}
          />
        </Field>
        <Field label={t('tokenSources.endpoint')}>
          <Input
            value={form.endpoint}
            disabled={saving}
            placeholder="https://broker.example.com/api/tokens"
            className="font-mono"
            onChange={(e) => set({ endpoint: e.target.value })}
          />
        </Field>
        <Field label={t('tokenSources.method')}>
          <Select
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
        </Field>

        <Field label={t('tokenSources.authMethod')}>
          <Select
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
        </Field>
        {form.authMethod === 'header' && (
          <Field label={t('tokenSources.headerName')}>
            <Input
              value={form.headerName}
              disabled={saving}
              placeholder="X-Api-Key"
              className="font-mono"
              onChange={(e) => set({ headerName: e.target.value })}
            />
          </Field>
        )}
        {needsSecret && (
          <Field label={t('tokenSources.secret')}>
            <Input
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
          </Field>
        )}

        <Text variant="muted" className="text-xs">
          {t('tokenSources.mappingHint')}
        </Text>
        <Field label={t('tokenSources.tokensPath')}>
          <Input
            value={form.tokensPath}
            disabled={saving}
            placeholder="$.tokens"
            className="font-mono"
            onChange={(e) => set({ tokensPath: e.target.value })}
          />
        </Field>
        <Field label={t('tokenSources.tokenField')}>
          <Input
            value={form.tokenField}
            disabled={saving}
            placeholder="access_token"
            className="font-mono"
            onChange={(e) => set({ tokenField: e.target.value })}
          />
        </Field>
        <Field label={t('tokenSources.statusField')}>
          <Input
            value={form.statusField}
            disabled={saving}
            placeholder="status"
            className="font-mono"
            onChange={(e) => set({ statusField: e.target.value })}
          />
        </Field>
        <Field label={t('tokenSources.statusActiveValue')}>
          <Input
            value={form.statusActiveValue}
            disabled={saving}
            placeholder="active"
            className="font-mono"
            onChange={(e) => set({ statusActiveValue: e.target.value })}
          />
        </Field>
        <Field label={t('tokenSources.expiryField')}>
          <Input
            value={form.expiryField}
            disabled={saving}
            placeholder="expires_at"
            className="font-mono"
            onChange={(e) => set({ expiryField: e.target.value })}
          />
        </Field>

        <Field label={t('tokenSources.targetEnvVar')}>
          <Input
            value={form.targetEnvVar}
            disabled={saving}
            placeholder="CLAUDE_CODE_OAUTH_TOKEN"
            className="font-mono"
            onChange={(e) => set({ targetEnvVar: e.target.value })}
          />
        </Field>
        <Field label={t('tokenSources.selection')}>
          <Select
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
        </Field>

        <HStack gap={2} className="justify-end">
          <Button
            variant="ghost"
            disabled={saving}
            onClick={() => setForm(null)}
          >
            {t('tokenSources.cancel')}
          </Button>
          <Button disabled={saving} onClick={() => void onSave()}>
            {saving ? t('tokenSources.saving') : t('tokenSources.save')}
          </Button>
        </HStack>
      </VStack>
    );
  }

  // --- List ---------------------------------------------------------------
  return (
    <VStack gap={3}>
      {!isLoading && (sources ?? []).length === 0 && (
        <Text variant="muted" className="text-sm">
          {t('tokenSources.empty')}
        </Text>
      )}
      {(sources ?? []).map((s) => (
        <HStack
          key={s.slug}
          gap={3}
          className="border-border items-center rounded-lg border p-3"
        >
          <VStack gap={0} className="min-w-0 flex-1">
            <Text className="truncate font-medium">{s.displayName}</Text>
            <Text variant="muted" className="truncate font-mono text-xs">
              {s.endpoint} → {s.targetEnvVar}
            </Text>
          </VStack>
          <Button
            size="icon"
            variant="ghost"
            aria-label={t('tokenSources.edit')}
            onClick={() => void openEdit(s.slug)}
          >
            <Pencil className="size-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label={t('tokenSources.delete')}
            onClick={() => void onDelete(s.slug)}
          >
            <Trash2 className="size-4" />
          </Button>
        </HStack>
      ))}
      <Button
        variant="ghost"
        className="self-start"
        onClick={() => setForm(emptyForm())}
      >
        <Plus className="size-4" />
        {t('tokenSources.new')}
      </Button>
    </VStack>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <VStack gap={1}>
      <Text className="text-sm font-medium">{label}</Text>
      {children}
    </VStack>
  );
}
