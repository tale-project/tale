'use client';

/** The Automations catalog: a config-driven grid of automations in the shared
 * catalog style (the same CatalogCard/CatalogToolbar/CatalogSection pieces the
 * agents and integrations catalogs use). Each automation is a first-class
 * automations/<slug>/automation.json bundle. The whole card is the click target — a
 * not-yet-installed automation opens the `AutomationPanel` preview (mirrors
 * `Integrations`' card → `IntegrationPanel`); an installed automation navigates
 * straight to its automation page. Every card also carries a ⋯ menu:
 * Reinstall/Uninstall once installed, Install (+ Delete for a private upload)
 * before. The Installed/All pill tabs split the org's installed automations
 * from the full catalog union. */
import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { EmptyState } from '@tale/ui/empty-state';
import { Stack } from '@tale/ui/layout';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { useNavigate } from '@tanstack/react-router';
import { Download, FileDown, LayoutGrid, Package } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { CatalogGridSkeleton } from '@/app/components/catalog/catalog-card-skeleton';
import {
  CatalogCard,
  CatalogCardIcon,
  CatalogGrid,
} from '@/app/components/catalog/catalog-grid';
import {
  CatalogSection,
  folderLabel,
  groupCatalogItems,
} from '@/app/components/catalog/catalog-section';
import { CatalogToolbar } from '@/app/components/catalog/catalog-toolbar';
import { useCatalogSearch } from '@/app/components/catalog/use-catalog-search';
import { EntityRowActions } from '@/app/components/ui/entity/entity-row-actions';
import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { downloadBase64File } from '@/lib/utils/download';

import { notifyOnInstallFailure } from '../hooks/install-failure-toast';
import {
  type AutomationSummary,
  useAutomationCatalog,
  useAutomations,
} from '../hooks/use-automations';
import { useExportAutomation } from '../hooks/use-export-automation';
import {
  type AutomationInstallState,
  deriveBundleInstallStatus,
  useAutomationInstallActions,
  useAutomationInstallStates,
} from '../hooks/use-install-state';
import { useAutomationDeleteAction } from './automation-delete-action';
import { AutomationIcon, AutomationLabels } from './automation-icon';
import { AutomationLifecycleActions } from './automation-lifecycle-actions';
import { AutomationPanel } from './automation-panel';
import { AutomationInstallWizard } from './install-wizard/automation-install-wizard';
import { BundleInstallWizard } from './install-wizard/bundle-install-wizard';

function InstallBadge({
  state,
}: {
  state: AutomationInstallState | undefined;
}) {
  const { t } = useT('automations');
  // Not installed: no state badge — the Install action is the signal (badge
  // slot is reserved for install STATE, mirroring the agent catalog).
  if (!state) {
    return null;
  }
  if (state.status === 'broken') {
    return <Badge variant="destructive">{t('install.reinstall')}</Badge>;
  }
  if (state.blockedIntegrations.length > 0) {
    return <Badge variant="yellow">{t('install.setup')}</Badge>;
  }
  return <Badge variant="green">{t('install.installed')}</Badge>;
}

/** A bundle's DERIVED install state (no `automationInstallations` row of its own —
 *  see `deriveBundleInstallStatus`). */
function BundleInstallStateBadge({
  memberSlugs,
  bySlug,
}: {
  memberSlugs: readonly string[];
  bySlug: ReadonlyMap<string, AutomationInstallState>;
}) {
  const { t } = useT('automations');
  const status = deriveBundleInstallStatus(memberSlugs, bySlug);
  if (status === 'not-installed') return null;
  if (status === 'broken') {
    return <Badge variant="destructive">{t('install.reinstall')}</Badge>;
  }
  if (status === 'partial') {
    return <Badge variant="yellow">{t('bundle.needsAttention')}</Badge>;
  }
  return <Badge variant="green">{t('install.installed')}</Badge>;
}

/** Search matches an automation's name or description. */
function automationHaystack(
  automation: AutomationSummary,
): ReadonlyArray<string | undefined> {
  return [automation.name, automation.description];
}

/**
 * The section an automation groups under: the top-level segment of its manifest
 * `folder` ('' = ungrouped → the trailing "General" section).
 */
function automationFolder(automation: AutomationSummary): string {
  return automation.folder?.split('/')[0] ?? '';
}

/**
 * Whether a catalog entry counts as "installed" for the Installed/All tab
 * split. A bundle carries no `automationInstallations` row of its own (see
 * `deriveBundleInstallStatus`) — it counts once ANY member has one, so an
 * operator who started (but didn't finish) its wizard can still find it.
 */
function isAutomationEntryInstalled(
  automation: AutomationSummary,
  bySlug: ReadonlyMap<string, AutomationInstallState>,
): boolean {
  if (automation.kind === 'bundle') {
    return (automation.members ?? []).some((slug) => bySlug.get(slug) != null);
  }
  return bySlug.get(automation.slug) != null;
}

/**
 * The not-yet-installed card's ⋯ menu: a quick Install (the same
 * wizard-vs-one-click branch the card itself used to run on click, now a
 * fast path alongside the whole-card click that opens the preview panel) +
 * Export (of the catalog bundle — export is not gated on installation) +
 * Delete for a private (uploaded) bundle. Combined into ONE dropdown — via
 * `useAutomationDeleteAction` — so a card never shows two ⋯ triggers.
 */
function NotInstalledMenu({
  automation,
  organizationId,
  isPrivate,
  isPending,
  onInstall,
}: {
  automation: AutomationSummary;
  organizationId: string;
  isPrivate: boolean;
  isPending: boolean;
  onInstall: () => void;
}) {
  const { t } = useT('automations');
  const { action: deleteAction, dialog: deleteDialog } =
    useAutomationDeleteAction({
      automationSlug: automation.slug,
      automationName: automation.name,
      organizationId,
    });
  const { mutateAsync: exportAutomation } = useExportAutomation();
  const [exporting, setExporting] = useState(false);
  const handleExport = useCallback(async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const result = await exportAutomation({
        organizationId,
        slug: automation.slug,
      });
      downloadBase64File(result.filename, result.dataBase64, 'application/zip');
    } catch (error) {
      console.error('[NotInstalledMenu] export failed:', error);
      toast({ title: t('install.exportFailed'), variant: 'destructive' });
    } finally {
      setExporting(false);
    }
  }, [exporting, exportAutomation, organizationId, automation.slug, t]);

  const actions = [
    {
      key: 'install',
      label: t('install.install'),
      icon: Download,
      onClick: onInstall,
      disabled: isPending,
    },
    {
      key: 'export',
      label: t('install.export'),
      icon: FileDown,
      onClick: () => void handleExport(),
      disabled: exporting,
    },
    ...(isPrivate ? [deleteAction] : []),
  ];

  return (
    <>
      <EntityRowActions
        actions={actions}
        ariaLabel={t('install.menuLabel', { name: automation.name })}
        disabled={isPending}
      />
      {isPrivate && deleteDialog}
    </>
  );
}

export interface AutomationsGridProps {
  organizationId: string;
  /** Deep-link target — opens the matching automation's panel/page once
   *  (mirrors `Integrations`' `initialSlug`). */
  initialSlug?: string;
  /** Called after `initialSlug` has been handled so the caller can clear the URL. */
  onInitialSlugConsumed?: () => void;
  /** Right-aligned toolbar slot (the page's Add-automation menu) — rendered
   *  in the search row, below the tab switch. */
  toolbarAction?: ReactNode;
}

export function AutomationsGrid({
  organizationId,
  initialSlug,
  onInitialSlugConsumed,
  toolbarAction,
}: AutomationsGridProps) {
  const { t } = useT('automations');
  const navigate = useNavigate();
  // The catalog shows the UNION of the org's installed automations and the built-in
  // catalog, keyed by slug. An installed entry wins (it carries the full
  // per-install data); a catalog-only entry renders the discovery card. This
  // is what makes a fresh org's catalog browsable instead of empty until automations
  // are seeded out-of-band.
  const { automations: installed, isLoading: installedLoading } =
    useAutomations(organizationId);
  const { automations: catalog, isLoading: catalogLoading } =
    useAutomationCatalog(organizationId);
  const isLoading = installedLoading || catalogLoading;
  const automations = useMemo(() => {
    const unionBySlug = new Map<string, AutomationSummary>();
    for (const automation of catalog)
      unionBySlug.set(automation.slug, automation);
    for (const automation of installed)
      unionBySlug.set(automation.slug, automation);
    return Array.from(unionBySlug.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }, [installed, catalog]);
  // member slug → its owning bundle summary — installed members card under
  // Installed with an extra "Uninstall bundle" action.
  const bundleByMember = useMemo(() => {
    const map = new Map<string, AutomationSummary>();
    for (const automation of automations) {
      if (automation.kind !== 'bundle') continue;
      for (const member of automation.members ?? []) {
        map.set(member, automation);
      }
    }
    return map;
  }, [automations]);
  // A private (uploaded) automation lives in the org's automations dir but not the built-in
  // catalog. It's the only kind the UI offers a Delete for (the server refuses
  // any built-in slug regardless), and it earns a "Private" badge so it's
  // distinguishable from a built-in card sharing the same display name.
  const catalogSlugs = useMemo(
    () => new Set(catalog.map((a) => a.slug)),
    [catalog],
  );
  const { bySlug } = useAutomationInstallStates(organizationId);
  const { install, isPending } = useAutomationInstallActions(organizationId);
  // The automation whose install wizard is open (the ⋯ menu's quick-Install path).
  // Project-scoped automations (need a target project) and automations with required
  // integrations (need a connect step) route through the wizard; org-scoped
  // automations with no requirements install in one click.
  const [wizardAutomation, setWizardAutomation] =
    useState<AutomationSummary | null>(null);
  // The bundle whose aggregated install wizard is open (⋯ menu quick path —
  // a bundle always routes through the wizard, never a one-click install).
  const [wizardBundle, setWizardBundle] = useState<AutomationSummary | null>(
    null,
  );
  // The not-yet-installed automation whose preview panel is open (a card click).
  const [panelAutomation, setPanelAutomation] =
    useState<AutomationSummary | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  // Installed = automations with an install row; All = the full catalog union.
  const [tab, setTab] = useState('installed');

  const tabItems = useMemo(
    () => [
      { value: 'installed', label: t('tabs.installed') },
      { value: 'all', label: t('tabs.all') },
    ],
    [t],
  );

  const tabbedAutomations = useMemo(
    () =>
      tab === 'installed'
        ? // What's actually installed: real install rows — a bundle's MEMBERS
          // card here (each with an "Uninstall bundle" action), never the
          // bundle itself (it has no installation of its own).
          automations.filter(
            (automation) =>
              automation.kind !== 'bundle' &&
              isAutomationEntryInstalled(automation, bySlug),
          )
        : // The catalog: the bundle is the browsable unit; its hidden
          // members never card here.
          automations.filter((automation) => automation.hidden !== true),
    [automations, tab, bySlug],
  );
  const filteredAutomations = useCatalogSearch(
    tabbedAutomations,
    searchQuery,
    automationHaystack,
  );

  // Section grouping by manifest folder. A flat catalog (no automation declares a
  // folder) renders one plain grid — the trailing "General" section only
  // appears once at least one named folder exists.
  const byFolder = useMemo(
    () => groupCatalogItems(filteredAutomations, automationFolder),
    [filteredAutomations],
  );
  const hasFolders = byFolder.some(([folder]) => folder !== '');

  const hasAutomations = automations.length > 0;

  const runInstall = useCallback(
    (automation: AutomationSummary) => {
      // A bundle always routes through its aggregated wizard — even an
      // org-scoped bundle with no required integrations still installs
      // several members at once, worth a review step.
      if (automation.kind === 'bundle') {
        setWizardBundle(automation);
      } else if (
        automation.scope === 'project' ||
        automation.requiredIntegrations.length > 0
      ) {
        setWizardAutomation(automation);
      } else {
        notifyOnInstallFailure(
          install(automation.slug),
          t('install.installFailed'),
        );
      }
    },
    [install, t],
  );

  // `?slug=` deep-link: open the matching automation once (installed →
  // navigate to its page, not-installed → open its preview panel), same
  // one-shot-consume shape as `Integrations`' `initialSlug`. A bundle has no
  // page of its own to navigate to — always its preview panel.
  const consumedSlugRef = useRef<string | null>(null);
  useEffect(() => {
    if (!initialSlug || consumedSlugRef.current === initialSlug) return;
    const match = automations.find((a) => a.slug === initialSlug);
    if (!match) return;
    consumedSlugRef.current = initialSlug;
    if (match.kind !== 'bundle' && bySlug.get(match.slug) != null) {
      void navigate({
        to: '/dashboard/$id/automations/$automationSlug',
        params: { id: organizationId, automationSlug: match.slug },
      });
    } else {
      setPanelAutomation(match);
    }
    onInitialSlugConsumed?.();
  }, [
    initialSlug,
    automations,
    bySlug,
    navigate,
    organizationId,
    onInitialSlugConsumed,
  ]);

  const renderCard = (automation: AutomationSummary) => {
    const isBundle = automation.kind === 'bundle';
    const state = bySlug.get(automation.slug);
    const isPrivate = !catalogSlugs.has(automation.slug);
    // A bundle has no page/lifecycle of its own — its card always opens the
    // preview panel and its ⋯ menu is always "Install" (idempotent per
    // member, so it doubles as "finish setup"/"reinstall").
    const isInstalled = !isBundle && state != null;
    const owningBundle = bundleByMember.get(automation.slug);
    const icon = (
      <CatalogCardIcon>
        <AutomationIcon
          automation={automation}
          className="text-muted-foreground size-5"
        />
      </CatalogCardIcon>
    );
    return (
      <CatalogCard
        key={automation.slug}
        media={
          isBundle ? (
            // A bundle is marked on the icon tile (corner glyph + hover
            // detail), not with a title-row chip — the badge slot stays
            // reserved for INSTALL state alone.
            <Tooltip
              content={t('bundle.memberCount', {
                count: (automation.members ?? []).length,
              })}
              side="top"
            >
              <div className="relative">
                {icon}
                <span className="bg-background ring-border absolute -right-1.5 -bottom-1.5 rounded-md p-0.5 ring-1">
                  <Package
                    aria-hidden="true"
                    className="text-muted-foreground size-3"
                  />
                </span>
              </div>
            </Tooltip>
          ) : (
            icon
          )
        }
        title={automation.name}
        description={automation.description}
        badge={
          <>
            {isPrivate && <Badge variant="slate">{t('private')}</Badge>}
            {isBundle ? (
              <BundleInstallStateBadge
                memberSlugs={automation.members ?? []}
                bySlug={bySlug}
              />
            ) : (
              <InstallBadge state={state} />
            )}
          </>
        }
        meta={
          automation.labels && automation.labels.length > 0 ? (
            <AutomationLabels labels={automation.labels} />
          ) : undefined
        }
        // Every installed automation opens its org-level page. For a project-scoped
        // automation that page is its membership hub (the list of bound projects +
        // Add); we never deep-link a single project from the catalog. A
        // not-yet-installed automation opens the preview panel instead of installing
        // outright — the ⋯ menu's Install item is the fast path. A bundle
        // always opens its preview panel (no page of its own).
        onClick={() =>
          isInstalled
            ? void navigate({
                to: '/dashboard/$id/automations/$automationSlug',
                params: { id: organizationId, automationSlug: automation.slug },
              })
            : setPanelAutomation(automation)
        }
        ariaLabel={automation.name}
        menu={
          isInstalled ? (
            <AutomationLifecycleActions
              automationSlug={automation.slug}
              automationName={automation.name}
              organizationId={organizationId}
              context="org"
              bundle={
                owningBundle
                  ? {
                      slug: owningBundle.slug,
                      name: owningBundle.name,
                      memberCount: (owningBundle.members ?? []).length,
                    }
                  : undefined
              }
            />
          ) : (
            <NotInstalledMenu
              automation={automation}
              organizationId={organizationId}
              isPrivate={isPrivate}
              isPending={isPending}
              onInstall={() => runInstall(automation)}
            />
          )
        }
      />
    );
  };

  // Loading: render the real toolbar over placeholder cards inside a single
  // Skeletonize so the catalog resolves under stable chrome rather than
  // swapping in from a blank text block.
  if (isLoading && !hasAutomations) {
    return (
      <Skeletonize loading label={t('title')}>
        <Stack gap={4}>
          <CatalogToolbar
            tabs={{ items: tabItems, value: tab, onValueChange: setTab }}
            search={{
              value: searchQuery,
              onChange: (e) => setSearchQuery(e.target.value),
              placeholder: t('searchPlaceholder'),
              disabled: true,
            }}
            action={toolbarAction}
          />
          <CatalogGridSkeleton menu />
        </Stack>
      </Skeletonize>
    );
  }

  if (!hasAutomations) {
    return (
      <EmptyState
        icon={LayoutGrid}
        title={t('empty.title')}
        description={t('empty.description')}
      />
    );
  }

  return (
    <Stack gap={4}>
      <CatalogToolbar
        tabs={{ items: tabItems, value: tab, onValueChange: setTab }}
        search={{
          value: searchQuery,
          onChange: (e) => setSearchQuery(e.target.value),
          placeholder: t('searchPlaceholder'),
        }}
        action={toolbarAction}
      />
      {filteredAutomations.length === 0 ? (
        searchQuery.trim().length > 0 ? (
          <EmptyState
            icon={LayoutGrid}
            title={t('noResults.title')}
            description={t('noResults.description')}
          />
        ) : (
          // The Installed tab with nothing installed yet — the All tab sits
          // right above, so the empty state needs no extra CTA.
          <EmptyState
            icon={LayoutGrid}
            title={t('empty.title')}
            description={t('empty.description')}
          />
        )
      ) : hasFolders ? (
        byFolder.map(([folder, items]) => (
          <CatalogSection key={folder} title={folderLabel(t, folder)}>
            <CatalogGrid>{items.map(renderCard)}</CatalogGrid>
          </CatalogSection>
        ))
      ) : (
        <CatalogGrid>{filteredAutomations.map(renderCard)}</CatalogGrid>
      )}
      {wizardAutomation && (
        <AutomationInstallWizard
          open
          onOpenChange={(o) => {
            if (!o) setWizardAutomation(null);
          }}
          organizationId={organizationId}
          automationSlug={wizardAutomation.slug}
          automationName={wizardAutomation.name}
          scope={wizardAutomation.scope}
          requiredIntegrations={wizardAutomation.requiredIntegrations}
        />
      )}
      {wizardBundle && (
        <BundleInstallWizard
          open
          onOpenChange={(o) => {
            if (!o) setWizardBundle(null);
          }}
          organizationId={organizationId}
          bundleSlug={wizardBundle.slug}
          bundleName={wizardBundle.name}
          scope={wizardBundle.scope}
        />
      )}
      {panelAutomation && (
        <AutomationPanel
          open
          onOpenChange={(open) => {
            if (!open) setPanelAutomation(null);
          }}
          organizationId={organizationId}
          automation={panelAutomation}
          isPrivate={!catalogSlugs.has(panelAutomation.slug)}
        />
      )}
    </Stack>
  );
}
