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
import { Stack } from '@tale/ui/layout';
import { SkeletonBox, SkeletonText } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import type { TFunction } from 'i18next';
import { Bot, TriangleAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  CatalogCard,
  CatalogCardIcon,
  CatalogGrid,
} from '@/app/components/catalog/catalog-grid';
import { SearchInput } from '@/app/components/ui/forms/search-input';
import { LabelBadges } from '@/app/components/ui/label-badges';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { resolveAgentLocale } from '@/lib/shared/utils/resolve-agent-locale';

import {
  useInstallCatalogAgent,
  useSetAgentEnabled,
  useUninstallAgent,
} from '../hooks/mutations';
import { useAgentInstallations, useListAgents } from '../hooks/queries';
import {
  agentLabels,
  agentRequiredIntegrations,
  toConfigurableAgent,
} from '../utils/agent-list-item';

interface AgentCatalogProps {
  organizationId: string;
}

interface CatalogEntry {
  slug: string;
  displayName: string;
  description?: string;
  /** Top-level folder (chat/workforce/github) — the catalog's visual section. */
  folder: string;
  /** Flat, equal catalog tags; rendered first + overflow, matched by search. */
  labels: string[];
  requiresIntegrations: string[];
  installed: boolean;
  enabled: boolean;
  installedBy?: string;
  bundledBy?: string;
}

/**
 * One row from `listInstallStates`, keyed in `installBySlug` by `agentSlug`.
 * Derived from the live query's element type so it can't drift from the backend
 * `installStateValidator` shape.
 */
type InstallStateRow = NonNullable<
  ReturnType<typeof useAgentInstallations>['data']
>[number];

/** Number of placeholder cards rendered while the catalog roster loads. */
const PLACEHOLDER_CARD_COUNT = 6;

/**
 * Localized title for a folder section. Known folders have dedicated keys
 * (`agentCatalog.folders.workforce` …); unknown folders fall back to a
 * capitalized form of the raw value so a new department still renders a sane
 * label even before a translation exists. `defaultValue` keeps i18next from
 * surfacing a raw key while the localized string lands.
 */
function folderLabel(t: TFunction, folder: string): string {
  const fallback = folder
    ? folder.charAt(0).toUpperCase() + folder.slice(1)
    : t('folders.other', { defaultValue: 'Other' });
  if (!folder) return fallback;
  return t(`folders.${folder}`, { defaultValue: fallback });
}

export function AgentCatalog({ organizationId }: AgentCatalogProps) {
  const { t } = useT('agentCatalog');
  const { i18n } = useTranslation();
  const locale = i18n.language;
  const {
    agents: rawAgents,
    isLoading,
    error: agentsError,
    refetch: refetchAgents,
  } = useListAgents(organizationId);
  const installStates = useAgentInstallations(organizationId);
  const [search, setSearch] = useState('');
  // Track slugs with an in-flight roster write so the card's buttons disable
  // until the reactive install-state query settles — prevents a double-click
  // firing install/enable twice. The mutations themselves are not optimistic
  // (listInstallStates is live and refreshes on its own).
  const [pendingSlugs, setPendingSlugs] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  // These hooks set `errorToast: false`; `run()` below owns the failure toast
  // so the catalog can surface a domain-specific message without double-toasting.
  const { mutateAsync: install } = useInstallCatalogAgent();
  const { mutateAsync: setEnabled } = useSetAgentEnabled();
  const { mutateAsync: uninstall } = useUninstallAgent();

  const installBySlug = useMemo(() => {
    const map = new Map<string, InstallStateRow>();
    for (const row of installStates.data ?? []) {
      map.set(row.agentSlug, row);
    }
    return map;
  }, [installStates.data]);

  const entries = useMemo<CatalogEntry[]>(() => {
    if (!rawAgents) return [];
    const out: CatalogEntry[] = [];
    for (const raw of rawAgents) {
      // Drops read-error rows + system agents (the Auto router etc.).
      const agent = toConfigurableAgent(raw);
      if (!agent) continue;
      // Catalog hides agents explicitly flagged out of the template catalog,
      // unless they're already installed (e.g. github-bundled).
      if (
        agent.metadata?.templateCatalog === false &&
        !installBySlug.has(agent.name)
      ) {
        continue;
      }
      const resolved = resolveAgentLocale(agent, locale);
      if (!resolved.displayName) continue;
      const state = installBySlug.get(agent.name);
      out.push({
        slug: agent.name,
        displayName: resolved.displayName,
        description: resolved.description,
        folder: agent.folder ?? '',
        labels: agentLabels(agent),
        requiresIntegrations: agentRequiredIntegrations(agent),
        installed: !!state,
        enabled: state?.enabled ?? false,
        installedBy: state?.installedBy,
        bundledBy: state?.bundledBy,
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
        e.labels.some((l) => l.toLowerCase().includes(q)),
    );
  }, [entries, search]);

  const byFolder = useMemo(() => {
    const groups = new Map<string, CatalogEntry[]>();
    for (const e of filtered) {
      const list = groups.get(e.folder) ?? [];
      list.push(e);
      groups.set(e.folder, list);
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  const run = async (
    slug: string,
    action: () => Promise<unknown>,
    okKey: string,
  ): Promise<void> => {
    setPendingSlugs((prev) => new Set(prev).add(slug));
    try {
      await action();
      toast({ title: t(okKey) });
    } catch (err) {
      toast({
        title: t('error'),
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setPendingSlugs((prev) => {
        const next = new Set(prev);
        next.delete(slug);
        return next;
      });
    }
  };

  // The action read failed (e.g. transient backend error) — distinct from an
  // empty roster, so offer a retry rather than the "no agents" empty state.
  if (agentsError) {
    return (
      <EmptyState
        icon={TriangleAlert}
        title={t('loadError.title')}
        description={t('loadError.description')}
        action={
          <Button variant="secondary" onClick={() => void refetchAgents()}>
            {t('loadError.retry')}
          </Button>
        }
      />
    );
  }

  // Loading: render the same grid shape with placeholder cards inside a single
  // Skeletonize so the roster resolves under stable page chrome (mirrors the
  // integrations catalog) rather than swapping in from a blank page.
  if (isLoading) {
    return (
      <Skeletonize loading label={t('title')}>
        <Stack gap={6}>
          <div className="w-64">
            <SkeletonBox>
              <div className="h-9 rounded-md" />
            </SkeletonBox>
          </div>
          <CatalogGrid>
            {Array.from({ length: PLACEHOLDER_CARD_COUNT }).map((_, i) => (
              <CatalogCardSkeleton key={i} />
            ))}
          </CatalogGrid>
        </Stack>
      </Skeletonize>
    );
  }

  if (entries.length === 0) {
    return (
      <EmptyState
        icon={Bot}
        title={t('empty.title')}
        description={t('empty.description')}
      />
    );
  }

  // Search resolved to nothing — keep the search box so the user can clear it,
  // and explain why the grid is empty rather than showing a bare page.
  const noSearchResults = filtered.length === 0 && search.trim().length > 0;

  return (
    <Stack gap={6}>
      <SearchInput
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t('searchPlaceholder')}
        className="w-64"
      />
      {noSearchResults ? (
        <EmptyState
          icon={Bot}
          title={t('noResults.title')}
          description={t('noResults.description')}
        />
      ) : (
        byFolder.map(([folder, items]) => (
          <Stack key={folder} gap={3}>
            <Text
              variant="caption"
              className="text-muted-foreground font-medium"
            >
              {folderLabel(t, folder)}
            </Text>
            <CatalogGrid>
              {items.map((entry) => (
                <AgentCatalogCard
                  key={entry.slug}
                  entry={entry}
                  t={t}
                  pending={pendingSlugs.has(entry.slug)}
                  onInstall={() =>
                    void run(
                      entry.slug,
                      () => install({ organizationId, agentSlug: entry.slug }),
                      'installed',
                    )
                  }
                  onToggleEnabled={() =>
                    void run(
                      entry.slug,
                      () =>
                        setEnabled({
                          organizationId,
                          agentSlug: entry.slug,
                          enabled: !entry.enabled,
                        }),
                      entry.enabled ? 'disabled' : 'enabled',
                    )
                  }
                  onUninstall={() =>
                    void run(
                      entry.slug,
                      () =>
                        uninstall({ organizationId, agentSlug: entry.slug }),
                      'uninstalled',
                    )
                  }
                />
              ))}
            </CatalogGrid>
          </Stack>
        ))
      )}
    </Stack>
  );
}

/** One catalog card: icon, status, labels, provenance badge, roster actions. */
function AgentCatalogCard({
  entry,
  t,
  pending,
  onInstall,
  onToggleEnabled,
  onUninstall,
}: {
  entry: CatalogEntry;
  t: TFunction;
  pending: boolean;
  onInstall: () => void;
  onToggleEnabled: () => void;
  onUninstall: () => void;
}) {
  const fromIntegration =
    entry.installedBy?.startsWith('integration:') || !!entry.bundledBy;

  const provenanceBadge = fromIntegration ? (
    <Badge variant="outline">
      {t('installedByIntegration', {
        integration: entry.bundledBy ?? entry.installedBy?.split(':')[1] ?? '',
      })}
    </Badge>
  ) : entry.requiresIntegrations.length > 0 && !entry.installed ? (
    <Badge variant="outline">
      {t('requiresIntegration', {
        integration: entry.requiresIntegrations.join(', '),
      })}
    </Badge>
  ) : null;

  const hasMeta = entry.labels.length > 0 || provenanceBadge !== null;

  return (
    <CatalogCard
      media={
        <CatalogCardIcon>
          <Bot className="text-muted-foreground size-5" />
        </CatalogCardIcon>
      }
      title={entry.displayName}
      description={entry.description}
      badge={<CatalogStatusBadge entry={entry} t={t} />}
      meta={
        hasMeta ? (
          <>
            <LabelBadges labels={entry.labels} />
            {provenanceBadge}
          </>
        ) : undefined
      }
      actions={
        !entry.installed ? (
          <Button size="sm" isLoading={pending} onClick={onInstall}>
            {t('install')}
          </Button>
        ) : (
          <>
            <Button
              size="sm"
              isLoading={pending}
              variant={entry.enabled ? 'secondary' : 'primary'}
              onClick={onToggleEnabled}
            >
              {entry.enabled ? t('disable') : t('enable')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={onUninstall}
            >
              {t('uninstall')}
            </Button>
          </>
        )
      }
    />
  );
}

/**
 * Placeholder card matching `CatalogCard`'s footprint (title + status badge,
 * two description lines, a label badge, an action button) so the loading grid
 * occupies the same height as the loaded grid. Decorative; the enclosing
 * `<Skeletonize>` owns the single status announcement.
 */
function CatalogCardSkeleton() {
  return (
    <Card contentClassName="flex h-full flex-col p-4">
      <div className="flex items-start gap-3">
        <SkeletonBox>
          <div className="size-10 rounded-lg" />
        </SkeletonBox>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-start justify-between gap-2">
            <div className="w-28 text-sm leading-none">
              <SkeletonText />
            </div>
            <SkeletonBox>
              <div className="h-5 w-16 rounded-full" />
            </SkeletonBox>
          </div>
          <div className="text-sm leading-snug">
            <SkeletonText lines={2} />
          </div>
        </div>
      </div>
      <div className="mt-auto pt-4">
        <SkeletonBox>
          <div className="h-8 w-20 rounded-md" />
        </SkeletonBox>
      </div>
    </Card>
  );
}

function CatalogStatusBadge({
  entry,
  t,
}: {
  entry: CatalogEntry;
  t: TFunction;
}) {
  if (!entry.installed) {
    return <Badge variant="outline">{t('status.available')}</Badge>;
  }
  if (!entry.enabled) {
    return <Badge variant="destructive">{t('status.disabled')}</Badge>;
  }
  return <Badge variant="green">{t('status.enabled')}</Badge>;
}
