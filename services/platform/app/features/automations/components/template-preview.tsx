'use client';

import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { CatalogCardIcon } from '@tale/ui/catalog/catalog-grid';
import { CatalogLabels } from '@tale/ui/catalog/catalog-labels';
import { CatalogLoadError } from '@tale/ui/catalog/catalog-view';
import { lazyComponent } from '@tale/ui/lazy-component';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Text } from '@tale/ui/text';
import { useRecurrenceFormat } from '@tale/ui/use-recurrence-format';
import { VendorIcon } from '@tale/ui/vendor-icon';
import { Link } from '@tanstack/react-router';
import {
  CirclePlus,
  type LucideIcon,
  PencilLine,
  Send,
  ShieldCheck,
} from 'lucide-react';
import { type ComponentProps, useId, useMemo } from 'react';

import { useT } from '@/lib/i18n/client';
import { isEmittedEventType } from '@/lib/shared/event-types';

import { mergeNodeTypes } from '../hooks/backend';
import { useNodeTypeCatalog } from '../hooks/queries';
import { eventWords } from '../lib/event-labels';
import { connectorName, nodeCatalogView } from '../lib/node-face';
import {
  categoryLabel,
  outcomeKindLabel,
  outcomeText,
  stepWords,
  type TemplateCard,
  type TemplateOutcome,
  templateWords,
} from '../lib/templates';
import { AutomationIcon } from './automation-icon';
import type { TemplatePreviewFlow as TemplatePreviewFlowImpl } from './template-preview-flow';

const TemplatePreviewFlow = lazyComponent<
  ComponentProps<typeof TemplatePreviewFlowImpl>
>(
  () =>
    import('./template-preview-flow').then((module) => ({
      default: module.TemplatePreviewFlow,
    })),
  {
    loading: () => <SkeletonBox className="h-full w-full">&nbsp;</SkeletonBox>,
  },
);

/** The icon each kind of outcome wears. */
const OUTCOME_ICONS: Record<TemplateOutcome['kind'], LucideIcon> = {
  creates: CirclePlus,
  changes: PencilLine,
  sends: Send,
  never: ShieldCheck,
};

/**
 * One template, before anyone uses it: what it does in its own words, how
 * it works step by step, what it creates, changes or sends and what it
 * never does, when it runs, what it needs connected (with the way to
 * connect it), the templates it works with, and its workflow drawn
 * read-only. Everything but the workflow comes with the catalog's card;
 * the workflow waits for the template's own read, and a read that failed
 * says so in its place, with the way to try again.
 */
export function TemplatePreview({
  organizationId,
  card,
  document,
  loadError,
  onRetry,
  isRetrying = false,
  cards,
  viewerZone,
  locale,
  onOpen,
}: {
  organizationId: string;
  card: TemplateCard;
  /** The document the template creates — undefined while it is read. */
  document: unknown;
  /** Why the template's read failed, while it has nothing to show. */
  loadError?: string;
  onRetry?: () => void;
  /** The read is being tried again. */
  isRetrying?: boolean;
  /** The whole catalog, for the templates it works with. */
  cards: readonly TemplateCard[];
  viewerZone: string;
  locale: string;
  /** Open another template's preview. */
  onOpen: (slug: string) => void;
}) {
  const { t } = useT('automations');
  const headingId = useId();
  const { schedule: scheduleText } = useRecurrenceFormat();
  const catalogQuery = useNodeTypeCatalog(organizationId);
  const catalog = useMemo(
    () =>
      nodeCatalogView(
        mergeNodeTypes(catalogQuery.data?.nodeTypes),
        catalogQuery.data?.connectors ?? [],
      ),
    [catalogQuery.data],
  );
  const words = templateWords(card, locale);
  const needed = card.connectors.filter((connector) => !connector.platform);
  const partners = card.worksWith
    .map((slug) => cards.find((other) => other.slug === slug))
    .filter((other) => other !== undefined);

  const trigger = card.trigger;
  const runs =
    trigger === null
      ? t('templates.runs.manual')
      : trigger.kind === 'webhook'
        ? t('templates.runs.webhook')
        : trigger.kind === 'event'
          ? t('templates.runs.event', {
              event:
                trigger.event !== null && isEmittedEventType(trigger.event)
                  ? eventWords(trigger.event, t).label
                  : (trigger.event ?? ''),
            })
          : trigger.repeat !== null
            ? t('templates.runs.schedule', {
                schedule: scheduleText(trigger.repeat),
                zone: viewerZone,
              })
            : t('templates.runs.cron', {
                cron: trigger.cron ?? '',
                zone: viewerZone,
              });

  const section = (key: string) => `${headingId}-${key}`;

  return (
    <div className="@container flex flex-col gap-6">
      <div className="flex items-start gap-4">
        <CatalogCardIcon>
          <AutomationIcon icon={card.icon} className="size-6" />
        </CatalogCardIcon>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Text as="p" className="text-sm leading-relaxed">
            {words.details}
          </Text>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="slate">{categoryLabel(t, card.category)}</Badge>
            {card.inUse > 0 && (
              <Badge variant="green">
                {t('templates.inUse', { count: card.inUse })}
              </Badge>
            )}
            <CatalogLabels labels={card.labels} tone="quiet" />
          </div>
        </div>
      </div>

      <div className="grid gap-6 @3xl:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
        <div className="flex min-w-0 flex-col gap-6">
          <section aria-labelledby={section('how')}>
            <Text
              as="h3"
              id={section('how')}
              className="mb-3 text-sm font-medium"
            >
              {t('templates.preview.howItWorks')}
            </Text>
            <ol className="flex flex-col gap-3">
              {card.steps.map((step, at) => {
                const own = stepWords(step, locale);
                return (
                  <li key={own.title} className="flex gap-3">
                    <span
                      aria-hidden
                      className="bg-muted text-muted-foreground flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium tabular-nums"
                    >
                      {at + 1}
                    </span>
                    <div className="flex min-w-0 flex-col gap-0.5 pt-0.5">
                      <span className="text-foreground text-sm font-medium">
                        {own.title}
                      </span>
                      {own.detail !== undefined && (
                        <span className="text-muted-foreground text-sm">
                          {own.detail}
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>

          <section aria-labelledby={section('changes')}>
            <Text
              as="h3"
              id={section('changes')}
              className="mb-3 text-sm font-medium"
            >
              {t('templates.preview.whatItChanges')}
            </Text>
            <ul className="flex flex-col gap-2">
              {card.outcomes.map((outcome) => {
                const Icon = OUTCOME_ICONS[outcome.kind];
                return (
                  <li
                    key={`${outcome.kind}:${outcome.text}`}
                    className="flex gap-2.5 text-sm"
                  >
                    <Icon
                      aria-hidden
                      className={
                        outcome.kind === 'never'
                          ? 'text-muted-foreground mt-0.5 size-4 shrink-0'
                          : 'text-primary mt-0.5 size-4 shrink-0'
                      }
                    />
                    <span>
                      {outcomeKindLabel(t, outcome.kind) !== null && (
                        <span className="sr-only">
                          {outcomeKindLabel(t, outcome.kind)}{' '}
                        </span>
                      )}
                      {outcomeText(outcome, locale)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <section aria-labelledby={section('runs')}>
            <Text
              as="h3"
              id={section('runs')}
              className="mb-2 text-sm font-medium"
            >
              {t('templates.preview.whenItRuns')}
            </Text>
            <Text as="p" variant="muted" className="text-sm">
              {runs}
            </Text>
          </section>

          <section aria-labelledby={section('needs')}>
            <Text
              as="h3"
              id={section('needs')}
              className="mb-2 text-sm font-medium"
            >
              {t('templates.preview.whatItNeeds')}
            </Text>
            {needed.length === 0 ? (
              <Text as="p" variant="muted" className="text-sm">
                {/* What one of the templates it works with brings in is what
                    it works on — an inbox a mail sync fills. */}
                {partners.length > 0
                  ? t('templates.preview.needsPartner')
                  : t('templates.preview.needsNothing')}
              </Text>
            ) : (
              <ul className="flex flex-col gap-2">
                {needed.map((connector) => (
                  <li
                    key={connector.slug}
                    className="flex flex-wrap items-center gap-2 text-sm"
                  >
                    <VendorIcon
                      {...(catalog.connectors.get(connector.slug)?.iconUrl !==
                        undefined && {
                        iconUrl: catalog.connectors.get(connector.slug)
                          ?.iconUrl,
                      })}
                      className="size-4"
                    />
                    <span className="text-foreground">
                      {connectorName(connector.slug, catalog, locale)}
                    </span>
                    {connector.connected ? (
                      <Badge variant="green">
                        {t('templates.preview.connected')}
                      </Badge>
                    ) : (
                      <>
                        <Badge variant="yellow">
                          {t('templates.preview.notConnected')}
                        </Badge>
                        <Link
                          to="/dashboard/$id/settings/connectors"
                          params={{ id: organizationId }}
                          className="text-foreground underline underline-offset-4"
                        >
                          {t('templates.preview.connect')}
                        </Link>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {partners.length > 0 && (
            <section aria-labelledby={section('works')}>
              <Text
                as="h3"
                id={section('works')}
                className="mb-2 text-sm font-medium"
              >
                {t('templates.preview.worksWith')}
              </Text>
              <ul className="flex flex-col gap-1.5">
                {partners.map((partner) => (
                  <li
                    key={partner.slug}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <AutomationIcon icon={partner.icon} className="size-4" />
                    <Button
                      type="button"
                      variant="link"
                      className="text-foreground h-auto min-h-0 p-0 text-sm"
                      onClick={() => onOpen(partner.slug)}
                    >
                      {templateWords(partner, locale).name}
                    </Button>
                    {partner.inUse > 0 && (
                      <Badge variant="green">
                        {t('templates.inUse', { count: partner.inUse })}
                      </Badge>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>

      <section aria-labelledby={section('flow')}>
        <Text as="h3" id={section('flow')} className="mb-1 text-sm font-medium">
          {t('templates.preview.workflow')}
        </Text>
        <Text as="p" variant="muted" className="mb-3 text-xs">
          {t('templates.preview.workflowHint')}
        </Text>
        {document === undefined && loadError !== undefined ? (
          <CatalogLoadError
            message={loadError}
            {...(onRetry !== undefined && { onRetry })}
            isRetrying={isRetrying}
          />
        ) : (
          <div className="h-[26rem]">
            {document === undefined ? (
              <SkeletonBox className="h-full w-full">&nbsp;</SkeletonBox>
            ) : (
              <TemplatePreviewFlow
                organizationId={organizationId}
                slug={card.slug}
                document={document}
                trigger={card.trigger}
                viewerZone={viewerZone}
              />
            )}
          </div>
        )}
      </section>
    </div>
  );
}
