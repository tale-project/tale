/**
 * Agent Catalog — browse the installable agent roster by department and
 * install / enable / disable agents for the organization. The agent JSON files
 * are the source of truth for metadata (displayName, description, group); the
 * `agentInstallations` table (via `listInstallStates`) tracks which are live.
 *
 * Reuses the existing browse-and-act primitives (Card, Grid, Badge, SearchInput,
 * EmptyState) — mirrors the integrations catalog. Roster writes are RLS + admin
 * gated server-side (the catalog mutations), so a non-admin simply sees the
 * action fail with a toast.
 */

import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { Card } from '@tale/ui/card';
import { EmptyState } from '@tale/ui/empty-state';
import { Grid, HStack, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { Bot } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { SearchInput } from '@/app/components/ui/forms/search-input';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { resolveAgentLocale } from '@/lib/shared/utils/resolve-agent-locale';

import {
  useInstallCatalogAgent,
  useSetAgentEnabled,
  useUninstallAgent,
} from '../hooks/mutations';
import { useAgentInstallations, useListAgents } from '../hooks/queries';

interface AgentCatalogProps {
  organizationId: string;
}

interface CatalogEntry {
  slug: string;
  displayName: string;
  description?: string;
  group: string;
  requiresIntegrations: string[];
  installed: boolean;
  enabled: boolean;
  installedBy?: string;
  bundledBy?: string;
  disabledReason?: 'integration_disabled' | 'user';
}

const UNGROUPED = 'Other';

export function AgentCatalog({ organizationId }: AgentCatalogProps) {
  const { t } = useT('agentCatalog');
  const { i18n } = useTranslation();
  const locale = i18n.language;
  const { agents: rawAgents, isLoading } = useListAgents(organizationId);
  const installStates = useAgentInstallations(organizationId);
  const [search, setSearch] = useState('');

  const { mutateAsync: install } = useInstallCatalogAgent();
  const { mutateAsync: setEnabled } = useSetAgentEnabled();
  const { mutateAsync: uninstall } = useUninstallAgent();

  const installBySlug = useMemo(() => {
    const map = new Map<
      string,
      {
        enabled: boolean;
        installedBy: string;
        bundledBy?: string;
        disabledReason?: 'integration_disabled' | 'user';
      }
    >();
    for (const row of installStates.data ?? []) {
      map.set(row.agentSlug, {
        enabled: row.enabled,
        installedBy: row.installedBy,
        bundledBy: row.bundledBy,
        disabledReason: row.disabledReason,
      });
    }
    return map;
  }, [installStates.data]);

  const entries = useMemo<CatalogEntry[]>(() => {
    if (!rawAgents) return [];
    const out: CatalogEntry[] = [];
    for (const a of rawAgents) {
      // Skip read-error rows + system agents (the Auto router etc.).
      if (!a || typeof a.name !== 'string' || 'status' in a) continue;
      if (a.uiConfigurable === false) continue;
      // oxlint-disable-next-line typescript/no-explicit-any -- metadata is optional config not in the narrow list type
      const meta = (a as { metadata?: Record<string, any> }).metadata ?? {};
      // Catalog hides agents explicitly flagged out of the template catalog.
      if (meta.templateCatalog === false && !installBySlug.has(a.name)) {
        // still show if installed (e.g. github-bundled), otherwise hide
        if (!installBySlug.has(a.name)) continue;
      }
      const resolved = resolveAgentLocale(a, locale);
      if (!resolved.displayName) continue;
      const state = installBySlug.get(a.name);
      out.push({
        slug: a.name,
        displayName: resolved.displayName,
        description: resolved.description,
        group: typeof meta.group === 'string' ? meta.group : UNGROUPED,
        requiresIntegrations: Array.isArray(meta.requires?.integrations)
          ? meta.requires.integrations
          : [],
        installed: !!state,
        enabled: state ? state.enabled : false,
        installedBy: state?.installedBy,
        bundledBy: state?.bundledBy,
        disabledReason: state?.disabledReason,
      });
    }
    return out;
  }, [rawAgents, locale, installBySlug]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (e) =>
        e.displayName.toLowerCase().includes(q) ||
        (e.description ?? '').toLowerCase().includes(q) ||
        e.group.toLowerCase().includes(q),
    );
  }, [entries, search]);

  const byGroup = useMemo(() => {
    const groups = new Map<string, CatalogEntry[]>();
    for (const e of filtered) {
      const list = groups.get(e.group) ?? [];
      list.push(e);
      groups.set(e.group, list);
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  const run = async (
    action: () => Promise<unknown>,
    okKey: string,
  ): Promise<void> => {
    try {
      await action();
      toast({ title: t(okKey) });
    } catch (err) {
      toast({
        title: t('error'),
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      });
    }
  };

  if (!isLoading && entries.length === 0) {
    return (
      <EmptyState
        icon={Bot}
        title={t('empty.title')}
        description={t('empty.description')}
      />
    );
  }

  return (
    <Stack gap={6}>
      <SearchInput
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t('searchPlaceholder')}
        className="w-64"
      />
      {byGroup.map(([group, items]) => (
        <Stack key={group} gap={3}>
          <Text variant="caption" className="text-muted-foreground font-medium">
            {group}
          </Text>
          <Grid cols={1} md={2} lg={3} gap={3}>
            {items.map((e) => (
              <Card key={e.slug} className="flex flex-col gap-3 p-4">
                <Stack gap={1}>
                  <HStack gap={2} align="center" justify="between">
                    <span className="truncate text-sm font-semibold">
                      {e.displayName}
                    </span>
                    <CatalogStatusBadge entry={e} t={t} />
                  </HStack>
                  {e.description ? (
                    <Text
                      variant="caption"
                      className="text-muted-foreground line-clamp-2 text-sm"
                    >
                      {e.description}
                    </Text>
                  ) : null}
                </Stack>

                {e.installedBy?.startsWith('integration:') || e.bundledBy ? (
                  <Badge variant="outline" className="w-fit">
                    {t('installedByIntegration', {
                      integration:
                        e.bundledBy ?? e.installedBy?.split(':')[1] ?? '',
                    })}
                  </Badge>
                ) : e.requiresIntegrations.length > 0 && !e.installed ? (
                  <Badge variant="outline" className="w-fit">
                    {t('requiresIntegration', {
                      integration: e.requiresIntegrations.join(', '),
                    })}
                  </Badge>
                ) : null}

                <HStack gap={2} className="mt-auto">
                  {!e.installed ? (
                    <Button
                      size="sm"
                      onClick={() =>
                        void run(
                          () => install({ organizationId, agentSlug: e.slug }),
                          'installed',
                        )
                      }
                    >
                      {t('install')}
                    </Button>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        variant={e.enabled ? 'secondary' : 'primary'}
                        onClick={() =>
                          void run(
                            () =>
                              setEnabled({
                                organizationId,
                                agentSlug: e.slug,
                                enabled: !e.enabled,
                              }),
                            e.enabled ? 'disabled' : 'enabled',
                          )
                        }
                      >
                        {e.enabled ? t('disable') : t('enable')}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          void run(
                            () =>
                              uninstall({ organizationId, agentSlug: e.slug }),
                            'uninstalled',
                          )
                        }
                      >
                        {t('uninstall')}
                      </Button>
                    </>
                  )}
                </HStack>
              </Card>
            ))}
          </Grid>
        </Stack>
      ))}
    </Stack>
  );
}

function CatalogStatusBadge({
  entry,
  t,
}: {
  entry: CatalogEntry;
  t: (key: string) => string;
}) {
  if (!entry.installed) {
    return <Badge variant="outline">{t('status.available')}</Badge>;
  }
  if (!entry.enabled) {
    return <Badge variant="destructive">{t('status.disabled')}</Badge>;
  }
  return <Badge variant="green">{t('status.enabled')}</Badge>;
}
