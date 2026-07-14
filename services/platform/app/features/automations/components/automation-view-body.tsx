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
import { Tabs } from '@tale/ui/tabs';
import { Text } from '@tale/ui/text';

import { useT } from '@/lib/i18n/client';
import { resolveLocalizedProp } from '@/lib/shared/utils/resolve-automation-locale';

import type {
  AutomationTabDoc,
  AutomationViewDoc,
  AutomationViewErrorStub,
} from '../hooks/use-automations';
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

/** A view body: the tabbed shell (navigated) or a flat Puck Data document.
 *  Tab labels resolve pack-authored `i18n.<locale>.label` over the English
 *  literal. */
function ViewBody({ view }: { view: AutomationViewDoc }) {
  const { locale } = useLocale();
  if (view.tabs && view.tabs.length > 0) {
    return (
      <Tabs
        variant="underline"
        defaultValue={view.tabs[0].id}
        items={view.tabs.map((tab) => ({
          value: tab.id,
          label:
            resolveLocalizedProp(tab.label, tab.i18n, 'label', locale) ??
            tab.label,
          content: <TabContent tab={tab} />,
        }))}
      />
    );
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
