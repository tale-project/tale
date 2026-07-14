'use client';

/**
 * A bundled view's rendered body — shared between the org automation page
 * (org-scoped automations keep their view tabs there) and the project view
 * pages (project-scoped views render as first-class project tabs). Extracted
 * from `automation-page.tsx` so the two surfaces can never drift.
 */
import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { Grid, VStack } from '@tale/ui/layout';
import { SkeletonText } from '@tale/ui/skeleton';
import { Tabs } from '@tale/ui/tabs';
import { Text } from '@tale/ui/text';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useT } from '@/lib/i18n/client';
import { resolveLocalizedProp } from '@/lib/shared/utils/resolve-automation-locale';

import type {
  AutomationTabDoc,
  AutomationViewDoc,
  AutomationViewErrorStub,
} from '../hooks/use-automations';
import { useBlockWhenGate } from '../hooks/use-block-when-gate';
import { AutomationView } from '../registry/automation-view';
import { PackMarkdown } from './pack-markdown';

/**
 * The stable route/tab id of a bundled view: its declared `id`, else the
 * same positional fallback the automation page has always used for its
 * `?tab=` values — the two surfaces must agree or deep links break.
 */
export function viewRouteId(
  view: Pick<AutomationViewDoc | AutomationViewErrorStub, 'id'>,
  index: number,
): string {
  const id = view.id;
  return typeof id === 'string' && id.length > 0 ? id : `view-${index + 1}`;
}

/** A tab's content: side-by-side columns, or a single Puck Data region. */
function TabContent({ tab }: { tab: AutomationTabDoc }) {
  if (tab.columns && tab.columns.length > 0) {
    return (
      <Grid lg={2} className="items-start">
        {tab.columns.map((col, i) => (
          <AutomationView key={i} data={col} />
        ))}
      </Grid>
    );
  }
  return <AutomationView data={tab.data} />;
}

/**
 * Evaluates one tab's `defaultWhen` predicate and reports `show` up. A tiny
 * component (not a loop of hooks) so each gate's `useBlockWhenGate` sits at a
 * component top level — lint-clean and stable regardless of tab count.
 */
function TabDefaultProbe({
  when,
  whenQuery,
  onResolve,
}: {
  when: string;
  whenQuery: { path: string; args?: unknown };
  onResolve: (matched: boolean) => void;
}) {
  const gate = useBlockWhenGate(when, whenQuery);
  useEffect(() => {
    if (gate.decision === 'pending') return;
    onResolve(gate.decision === 'show');
  }, [gate.decision, onResolve]);
  return null;
}

/**
 * The tabbed shell. A tab may carry `defaultWhen` (predicate + query): the
 * FIRST tab whose predicate holds becomes the initial selection instead of
 * `tabs[0]` — a data-driven onboarding steer (e.g. land on Setup while the
 * setup folder is missing). Resolved once, as the uncontrolled default; a
 * later user tab switch is never fought.
 */
function TabbedViewBody({
  tabs,
}: {
  tabs: NonNullable<AutomationViewDoc['tabs']>;
}) {
  const { locale } = useLocale();
  const gatedTabs = tabs.filter((tab) => tab.defaultWhen);
  const [matched, setMatched] = useState<Record<string, boolean>>({});
  const onResolve = useCallback(
    (id: string, isMatch: boolean) =>
      setMatched((prev) =>
        prev[id] === isMatch ? prev : { ...prev, [id]: isMatch },
      ),
    [],
  );

  // Commit the initial tab once every gated tab has reported: the first tab
  // whose predicate held, else `tabs[0]`. Held in a ref so a later data
  // change (e.g. Setup gets created) never yanks the operator's current tab.
  const allResolved = gatedTabs.every((tab) => tab.id in matched);
  const initialTabRef = useRef<string | null>(null);
  if (initialTabRef.current === null && allResolved) {
    initialTabRef.current = (
      tabs.find((tab) => tab.defaultWhen && matched[tab.id]) ?? tabs[0]
    ).id;
  }

  const probes = gatedTabs.map((tab) => (
    <TabDefaultProbe
      key={tab.id}
      // defaultWhen presence is what put the tab in gatedTabs.
      when={tab.defaultWhen?.when ?? ''}
      whenQuery={tab.defaultWhen?.whenQuery ?? { path: '', args: {} }}
      onResolve={(isMatch) => onResolve(tab.id, isMatch)}
    />
  ));

  if (initialTabRef.current === null) {
    // Still resolving a `defaultWhen` gate (rare, sub-second) — don't commit
    // tabs[0] prematurely and then jump; show the skeleton while probes run.
    return (
      <>
        {probes}
        <SkeletonText lines={6} />
      </>
    );
  }
  return (
    <>
      {probes}
      <Tabs
        variant="underline"
        defaultValue={initialTabRef.current}
        items={tabs.map((tab) => ({
          value: tab.id,
          label:
            resolveLocalizedProp(tab.label, tab.i18n, 'label', locale) ??
            tab.label,
          content: <TabContent tab={tab} />,
        }))}
      />
    </>
  );
}

/** A view body: the tabbed shell (navigated) or a flat Puck Data document. */
function ViewBody({ view }: { view: AutomationViewDoc }) {
  if (view.tabs && view.tabs.length > 0) {
    return <TabbedViewBody tabs={view.tabs} />;
  }
  return <AutomationView data={view.data} />;
}

/** The localized description (markdown) over the view's tabbed/flat body. */
export function AutomationViewBody({ view }: { view: AutomationViewDoc }) {
  const { locale } = useLocale();
  const viewDescription = resolveLocalizedProp(
    view.description,
    view.i18n,
    'description',
    locale,
  );
  return (
    <VStack gap={4}>
      {viewDescription && (
        <PackMarkdown text={viewDescription} variant="muted" />
      )}
      <ViewBody view={view} />
    </VStack>
  );
}

/**
 * The repair affordance for a view whose JSON failed validation at install
 * time — names the error and offers the shared reinstall preflight.
 */
export function ViewErrorStubAlert({
  message,
  onReinstall,
  isPending,
}: {
  message: string;
  onReinstall: () => void;
  isPending: boolean;
}) {
  const { t } = useT('automations');
  return (
    <Alert variant="destructive" title={t('viewInvalid.title')}>
      <VStack gap={3}>
        <Text>{t('viewInvalid.description')}</Text>
        <Text variant="muted" className="text-sm">
          {message}
        </Text>
        <Button
          variant="secondary"
          size="sm"
          className="self-start"
          disabled={isPending}
          onClick={onReinstall}
        >
          {t('viewInvalid.reinstall')}
        </Button>
      </VStack>
    </Alert>
  );
}
