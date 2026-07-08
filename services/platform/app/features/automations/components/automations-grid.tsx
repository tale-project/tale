'use client';

/** The Automations catalog: a config-driven grid of automations in the shared
 * catalog style (the same CatalogCard/CatalogToolbar/CatalogSection pieces the
 * agents and integrations catalogs use). Each automation is a first-class
 * automations/<slug>/automation.json bundle. The whole card is the click target — a
 * not-yet-installed automation opens the `AutomationPanel` preview (mirrors
 * `Integrations`' card → `IntegrationPanel`); an installed automation navigates
 * straight to its automation page. Every card also carries a ⋯ menu:
 * Reinstall/Uninstall once installed, Install (+ Delete for a custom upload)
 * before; an installed BUNDLE gets the bundle lifecycle instead. The Installed/All
 * split comes from the route's `?tab=`, driven by the page header's shared
 * `TabNavigation` (`AutomationsNavigation`) — not a toolbar pill strip. */
import { Badge } from '@tale/ui/badge';
import { EmptyState } from '@tale/ui/empty-state';
import { Stack } from '@tale/ui/layout';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { useNavigate } from '@tanstack/react-router';
import {
  Download,
  FileDown,
  LayoutGrid,
  Package,
  PackageMinus,
  RotateCw,
  UserPen,
} from 'lucide-react';
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
import { DeleteDialog } from '@/app/components/ui/dialog/delete-dialog';
import {
  EntityRowActions,
  useEntityRowDialogs,
} from '@/app/components/ui/entity/entity-row-actions';
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
import { AutomationContentsList } from './automation-contents-list';
import { useAutomationDeleteAction } from './automation-delete-action';
import {
  AutomationIcon,
  AutomationLabels,
  AutomationMarker,
} from './automation-icon';
import { AutomationLifecycleActions } from './automation-lifecycle-actions';
import { AutomationPanel } from './automation-panel';
import {
  type AutomationsTab,
  DEFAULT_AUTOMATIONS_TAB,
} from './automations-navigation';
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
  // ANY incomplete install reads "Finish setup" — a broken install is just a
  // louder one (destructive tone, its repair is Reinstall in the ⋯ menu). The
  // specific blocker is named on the automation's readiness banner.
  if (state.status === 'broken') {
    return <Badge variant="destructive">{t('install.setup')}</Badge>;
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
 * Delete for a custom (uploaded) bundle. Combined into ONE dropdown — via
 * `useAutomationDeleteAction` — so a card never shows two ⋯ triggers.
 */
function NotInstalledMenu({
  automation,
  organizationId,
  isCustom,
  isPending,
  onInstall,
}: {
  automation: AutomationSummary;
  organizationId: string;
  isCustom: boolean;
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
    ...(isCustom ? [deleteAction] : []),
  ];

  return (
    <>
      <EntityRowActions
        actions={actions}
        ariaLabel={t('install.menuLabel', { name: automation.name })}
        disabled={isPending}
      />
      {isCustom && deleteDialog}
    </>
  );
}

/**
 * The installed bundle card's ⋯ menu. A bundle carries no
 * `automationInstallations` row of its own, so its lifecycle is aggregated over
 * its members: Reinstall re-opens the bundle wizard (re-runs the idempotent
 * per-member install), Export downloads the bundle, and "Uninstall bundle"
 * tears every member down. Without this, an installed bundle wrongly showed the
 * not-installed Install menu next to its green "Installed" badge.
 */
function InstalledBundleMenu({
  bundle,
  organizationId,
  onReinstall,
}: {
  bundle: AutomationSummary;
  organizationId: string;
  onReinstall: () => void;
}) {
  const { t } = useT('automations');
  const { uninstallBundle } = useAutomationInstallActions(organizationId);
  const { mutateAsync: exportAutomation } = useExportAutomation();
  const dialogs = useEntityRowDialogs(['uninstallBundle']);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const memberCount = (bundle.members ?? []).length;

  const handleExport = useCallback(async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const result = await exportAutomation({
        organizationId,
        slug: bundle.slug,
      });
      downloadBase64File(result.filename, result.dataBase64, 'application/zip');
    } catch (error) {
      console.error('[InstalledBundleMenu] export failed:', error);
      toast({ title: t('install.exportFailed'), variant: 'destructive' });
    } finally {
      setExporting(false);
    }
  }, [exporting, exportAutomation, organizationId, bundle.slug, t]);

  const handleUninstallBundle = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await uninstallBundle(bundle.slug);
      toast({ title: t('install.bundleUninstalled'), variant: 'success' });
      dialogs.setOpen.uninstallBundle(false);
    } catch (error) {
      console.error('[InstalledBundleMenu] uninstall failed:', error);
      toast({
        title: t('install.bundleUninstallFailed'),
        variant: 'destructive',
      });
      dialogs.setOpen.uninstallBundle(false);
    } finally {
      setBusy(false);
    }
  }, [busy, uninstallBundle, bundle.slug, t, dialogs]);

  const actions = [
    {
      key: 'reinstall',
      label: t('install.reinstall'),
      icon: RotateCw,
      onClick: onReinstall,
    },
    {
      key: 'export',
      label: t('install.export'),
      icon: FileDown,
      onClick: () => void handleExport(),
      disabled: exporting,
    },
    {
      key: 'uninstallBundle',
      label: t('install.uninstallBundle'),
      icon: PackageMinus,
      destructive: true,
      onClick: () => dialogs.open.uninstallBundle(),
    },
  ];

  return (
    <>
      <EntityRowActions
        actions={actions}
        ariaLabel={t('install.menuLabel', { name: bundle.name })}
        disabled={busy}
      />
      <DeleteDialog
        open={dialogs.isOpen.uninstallBundle}
        onOpenChange={dialogs.setOpen.uninstallBundle}
        title={t('install.uninstallBundleTitle')}
        description={t('install.uninstallBundleDescription', {
          count: memberCount,
        })}
        preview={{ primary: bundle.name }}
        warning={t('install.uninstallWarning')}
        deleteText={t('install.uninstallBundle')}
        isDeleting={busy}
        onDelete={() => void handleUninstallBundle()}
      >
        {dialogs.isOpen.uninstallBundle && (
          <AutomationContentsList
            organizationId={organizationId}
            automation={bundle}
            heading={t('install.uninstallContents')}
          />
        )}
      </DeleteDialog>
    </>
  );
}

export interface AutomationsGridProps {
  organizationId: string;
  /** Which content filter to render. Owned by the route's `?tab=` search param
   *  and driven by the layout's header tab strip (`AutomationsNavigation`). */
  tab?: AutomationsTab;
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
  tab = DEFAULT_AUTOMATIONS_TAB,
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
  // A CUSTOM (uploaded) automation lives in the org's automations dir but not the
  // built-in catalog. It's the only kind the UI offers a Delete for (the server
  // refuses any built-in slug regardless), and it earns a "Custom" corner glyph
  // so it's distinguishable from a built-in card sharing the same display name.
  // A bundle MEMBER is never custom: it IS built-in, merely hidden from the
  // catalog, so the catalog check alone would mislabel it.
  const catalogSlugs = useMemo(
    () => new Set(catalog.map((a) => a.slug)),
    [catalog],
  );
  const isCustomAutomation = useCallback(
    (automation: AutomationSummary) =>
      !catalogSlugs.has(automation.slug) &&
      !bundleByMember.has(automation.slug),
    [catalogSlugs, bundleByMember],
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
  // The switch itself lives in the page header (`AutomationsNavigation`).
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
    // A bundle has no `automationInstallations` row of its own — `isInstalled`
    // only ever applies to a real automation install. A bundle card opens the
    // preview panel; its ⋯ menu is the bundle lifecycle once any member is
    // installed (`bundleInstalled`), else the not-installed Install menu.
    const isInstalled = !isBundle && state != null;
    const owningBundle = bundleByMember.get(automation.slug);
    // "Custom" = an uploaded automation: it lives in the org's automations dir
    // but not the built-in catalog. Bundle MEMBERS are excluded — they're
    // built-in, just hidden from the catalog, so the catalog check alone would
    // both mislabel them and wrongly offer Delete.
    const isCustom = isCustomAutomation(automation);
    const bundleInstalled =
      isBundle &&
      deriveBundleInstallStatus(automation.members ?? [], bySlug) !==
        'not-installed';
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
          // A bundle, and a custom (uploaded) automation, are marked on the icon
          // tile with a corner glyph — never a title-row chip, so the badge slot
          // stays reserved for INSTALL state alone.
          isBundle ? (
            <AutomationMarker
              icon={Package}
              label={t('bundle.memberCount', {
                count: (automation.members ?? []).length,
              })}
            >
              {icon}
            </AutomationMarker>
          ) : isCustom ? (
            <AutomationMarker icon={UserPen} label={t('custom')}>
              {icon}
            </AutomationMarker>
          ) : (
            icon
          )
        }
        title={automation.name}
        description={automation.description}
        badge={
          isBundle ? (
            <BundleInstallStateBadge
              memberSlugs={automation.members ?? []}
              bySlug={bySlug}
            />
          ) : (
            <InstallBadge state={state} />
          )
        }
        meta={
          automation.labels && automation.labels.length > 0 ? (
            <AutomationLabels labels={automation.labels} />
          ) : undefined
        }
        // Every installed automation opens its org-level page — the tabbed
        // Editor/Executions/Configuration/Triggers/Integrations shell. For a
        // project-scoped automation the projects it runs in are a section of that
        // page's Configuration tab; we never deep-link a single project from the
        // catalog. A not-yet-installed automation opens the preview panel instead of
        // installing outright — the ⋯ menu's Install item is the fast path. A bundle
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
          bundleInstalled ? (
            <InstalledBundleMenu
              bundle={automation}
              organizationId={organizationId}
              onReinstall={() => setWizardBundle(automation)}
            />
          ) : isInstalled ? (
            <AutomationLifecycleActions
              automationSlug={automation.slug}
              automationName={automation.name}
              organizationId={organizationId}
              context="org"
              scope={automation.scope}
              requiredIntegrations={automation.requiredIntegrations}
              blockedIntegrations={state?.blockedIntegrations}
              broken={state?.status === 'broken'}
              bundle={owningBundle}
            />
          ) : (
            <NotInstalledMenu
              automation={automation}
              organizationId={organizationId}
              isCustom={isCustom}
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
          isCustom={isCustomAutomation(panelAutomation)}
        />
      )}
    </Stack>
  );
}
