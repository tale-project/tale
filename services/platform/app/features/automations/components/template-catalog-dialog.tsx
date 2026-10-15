'use client';

import { Alert } from '@tale/ui/alert';
import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { CatalogCard, CatalogCardIcon } from '@tale/ui/catalog/catalog-grid';
import { CatalogToolbar } from '@tale/ui/catalog/catalog-toolbar';
import { CatalogView } from '@tale/ui/catalog/catalog-view';
import { useCatalogSearch } from '@tale/ui/catalog/use-catalog-search';
import { CopyableField } from '@tale/ui/copyable-field';
import { Dialog } from '@tale/ui/dialog/dialog';
import { Stack } from '@tale/ui/layout';
import { useRecurrenceFormat } from '@tale/ui/use-recurrence-format';
import { useNavigate } from '@tanstack/react-router';
import { KeyRound, LayoutTemplate } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';

import { automationSlugToParam } from '@/lib/automations/slug';
import { useT } from '@/lib/i18n/client';
import { isEmittedEventType } from '@/lib/shared/event-types';
import { localTimeZone } from '@/lib/shared/zoned-time';

import {
  useAutomationTemplate,
  useAutomationTemplates,
} from '../hooks/queries';
import { automationErrorMessage } from '../lib/errors';
import { eventWords } from '../lib/event-labels';
import {
  categoryLabel,
  missingConnectors,
  sortTemplates,
  TEMPLATE_CATEGORY_ORDER,
  type TemplateCard,
  type TemplateCategory,
  templateCategoryOf,
  templateHaystack,
  templateWords,
} from '../lib/templates';
import { AutomationIcon } from './automation-icon';
import { TemplatePreview } from './template-preview';
import {
  type TemplateCreated,
  TemplateSetupFields,
  useTemplateSetup,
} from './template-setup';
import { webhookBase } from './trigger-webhook-panel';

/** Where the catalog dialog is: browsing, one template's preview, its
 * questions, or the webhook address a create minted, shown once. */
type CatalogStep =
  | { kind: 'catalog' }
  | { kind: 'preview'; slug: string }
  | { kind: 'setup'; slug: string }
  | { kind: 'minted'; created: TemplateCreated };

/** One step's identity: a new one starts at the top of the dialog. */
function stepKeyOf(step: CatalogStep): string {
  return step.kind === 'preview' || step.kind === 'setup'
    ? `${step.kind}:${step.slug}`
    : step.kind;
}

/**
 * "From a template": every automation Tale ships, in ONE dialog — the
 * catalog (category tabs, search, a card per template with its product's
 * logo), a template's preview (what it does, changes, needs and when it
 * runs, and its workflow drawn read-only), its few questions, then — for a
 * template a webhook starts — its address, shown once. The back control in
 * the header returns a step, to the reader's place: the catalog keeps its
 * tab, its search and the card they opened, and the questions keep their
 * answers. Each step starts at its top; on a phone the dialog is a sheet.
 *
 * Created in a project page, a template's project question starts on that
 * project, and the automation opens there.
 */
export function TemplateCatalogDialog({
  organizationId,
  projectId,
  open,
  onOpenChange,
  initialCategory,
}: {
  organizationId: string;
  projectId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The tab the catalog opens on — the Inbox's setup notice opens it on
   * Inbox. All when unset. */
  initialCategory?: TemplateCategory;
}) {
  const { t } = useT('automations');
  const { i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en';
  const navigate = useNavigate();
  const [step, setStep] = useState<CatalogStep>({ kind: 'catalog' });
  // The reader's place in the catalog, kept while a preview or the
  // questions are open: its tab, its search, and the card they opened,
  // which has focus again on the way back.
  const [category, setCategory] = useState<TemplateCategory | 'all'>(
    initialCategory ?? 'all',
  );
  const [query, setQuery] = useState('');
  const openedCard = useRef<string | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [viewerZone] = useState(localTimeZone);
  const templates = useAutomationTemplates(organizationId, open);
  const cards = useMemo(
    () => templates.data?.templates ?? [],
    [templates.data],
  );
  const openSlug =
    step.kind === 'preview' || step.kind === 'setup' ? step.slug : null;
  const detail = useAutomationTemplate(organizationId, openSlug);
  const card =
    openSlug === null
      ? null
      : (cards.find((entry) => entry.slug === openSlug) ?? null);

  useEffect(() => {
    if (!open) return;
    setStep({ kind: 'catalog' });
    setCategory(initialCategory ?? 'all');
    setQuery('');
    openedCard.current = null;
  }, [open, initialCategory]);

  const stepKey = stepKeyOf(step);
  const shownStep = useRef(stepKey);
  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (frame === null || shownStep.current === stepKey) return;
    shownStep.current = stepKey;
    // Each step starts at its top. The dialog's body keeps its scroll
    // otherwise, and a card opened low in the catalog opened its preview
    // mid-way.
    for (
      let node = frame.parentElement;
      node !== null && !node.hasAttribute('data-tale-modal');
      node = node.parentElement
    ) {
      node.scrollTop = 0;
    }
    // Back in the catalog, the card the reader opened has focus again —
    // scrolled into view — rather than the dialog.
    if (stepKey === 'catalog' && openedCard.current !== null) {
      const slug = openedCard.current;
      const opened = [
        ...frame.querySelectorAll<HTMLElement>('[data-template-card]'),
      ].find((entry) => entry.dataset.templateCard === slug);
      opened?.querySelector<HTMLElement>('button')?.focus();
    }
  }, [stepKey]);

  const openAutomation = (created: TemplateCreated): void => {
    onOpenChange(false);
    const automationSlug = automationSlugToParam(created.name);
    if (projectId !== undefined && created.projectId === projectId) {
      void navigate({
        to: '/dashboard/$id/projects/$projectId/automations/$automationSlug',
        params: { id: organizationId, projectId, automationSlug },
      });
      return;
    }
    void navigate({
      to: '/dashboard/$id/automations/$automationSlug',
      params: { id: organizationId, automationSlug },
    });
  };

  // The questions' answers live while the template is open — through its
  // preview and back — so the way back from the questions keeps them.
  const setup = useTemplateSetup({
    organizationId,
    template:
      openSlug !== null && detail.data?.slug === openSlug ? detail.data : null,
    locale,
    ...(projectId !== undefined && { projectId }),
    onCreated: (created) => {
      if (created.token !== undefined) {
        setStep({ kind: 'minted', created });
        return;
      }
      openAutomation(created);
    },
  });

  const words = card === null ? null : templateWords(card, locale);
  const detailReady = openSlug !== null && detail.data?.slug === openSlug;
  const detailFailure =
    !detailReady && detail.isError
      ? t('templates.loadTemplateFailed', {
          error: automationErrorMessage(detail.error),
        })
      : undefined;
  const creating = setup?.submitting === true;
  const title =
    step.kind === 'minted'
      ? t('templates.webhookTitle')
      : words !== null
        ? words.name
        : t('templates.title');
  const description =
    step.kind === 'minted'
      ? t('blank.stepWebhook')
      : step.kind === 'setup'
        ? t('templates.setupDescription')
        : step.kind === 'preview'
          ? (words?.description ?? t('templates.description'))
          : t('templates.description');

  const back =
    step.kind === 'preview'
      ? {
          onBack: () => setStep({ kind: 'catalog' }),
          backLabel: t('templates.backToCatalog'),
        }
      : step.kind === 'setup'
        ? {
            onBack: () => setStep({ kind: 'preview', slug: step.slug }),
            backLabel: t('templates.backToPreview'),
            backDisabled: creating,
          }
        : {};

  // The primary button is a new element on each step (its own `key`): one
  // reused would turn "Use this template" into the form's submit under a
  // double click or a double Enter, creating it with every default.
  const footer =
    step.kind === 'minted' ? (
      <Button
        key="open"
        type="button"
        onClick={() => openAutomation(step.created)}
      >
        {t('blank.openAutomation')}
      </Button>
    ) : step.kind === 'preview' ? (
      <>
        <Button
          type="button"
          variant="secondary"
          onClick={() => onOpenChange(false)}
        >
          {t('blank.cancel')}
        </Button>
        <Button
          key="use"
          type="button"
          disabled={!detailReady}
          {...(!detailReady && {
            disabledReason: detailFailure ?? t('templates.loadingTemplate'),
          })}
          onClick={() => setStep({ kind: 'setup', slug: step.slug })}
        >
          {t('templates.use')}
        </Button>
      </>
    ) : step.kind === 'setup' && setup !== null ? (
      <>
        <Button
          type="button"
          variant="secondary"
          onClick={() => onOpenChange(false)}
          disabled={setup.submitting}
        >
          {t('blank.cancel')}
        </Button>
        <Button
          key="create"
          type="submit"
          form={setup.formId}
          disabled={!setup.canSubmit}
          {...(!setup.canSubmit &&
            setup.disabledReason !== undefined && {
              disabledReason: setup.disabledReason,
            })}
          isLoading={setup.submitting}
          onClick={(event) => {
            // The second click of a double click on "Use this template"
            // lands here once the questions open: only a click of its own
            // creates.
            if (event.detail > 1) event.preventDefault();
          }}
        >
          {setup.submitting ? t('blank.submitting') : t('templates.create')}
        </Button>
      </>
    ) : undefined;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // While it creates, the dialog stays: closing it then would lose
        // what the create answers — a webhook address is shown only once.
        if (!next && creating) return;
        // Closing the address screen any way still lands on the automation —
        // the address is gone from the page either way.
        if (!next && step.kind === 'minted') {
          openAutomation(step.created);
          return;
        }
        onOpenChange(next);
      }}
      hideClose={creating}
      size="wide"
      title={title}
      description={description}
      // The catalog, a preview and its questions share one stable frame, so
      // the footer stays where the reader's pointer is; the address sizes
      // to itself.
      className={
        step.kind === 'minted' ? undefined : 'md:h-[85dvh] md:max-h-[85dvh]'
      }
      {...back}
      {...(footer !== undefined && { footer })}
    >
      <div ref={frameRef} className="contents">
        {step.kind === 'minted' && step.created.token !== undefined ? (
          <Stack gap={4}>
            <Alert
              variant="warning"
              icon={KeyRound}
              title={t('trigger.tokenTitle')}
              description={t('trigger.tokenHint')}
            />
            <CopyableField
              label={t('trigger.webhookEndpointLabel')}
              value={`${webhookBase(
                typeof window === 'undefined' ? '' : window.location.origin,
                step.created.projectId,
              )}${step.created.token}`}
              mono
              copyAriaLabel={t('blank.copyWebhookUrl')}
              description={t('trigger.webhook.sampleEnv')}
            />
          </Stack>
        ) : step.kind === 'setup' && setup !== null && detail.data ? (
          <TemplateSetupFields
            organizationId={organizationId}
            template={detail.data}
            setup={setup}
            locale={locale}
          />
        ) : (step.kind === 'preview' || step.kind === 'setup') &&
          card !== null ? (
          <TemplatePreview
            organizationId={organizationId}
            card={card}
            document={
              detail.data?.slug === card.slug ? detail.data.document : undefined
            }
            {...(detailFailure !== undefined && {
              loadError: detailFailure,
              onRetry: () => void detail.refetch(),
              isRetrying: detail.isFetching,
            })}
            cards={cards}
            viewerZone={viewerZone}
            locale={locale}
            onOpen={(slug) => setStep({ kind: 'preview', slug })}
          />
        ) : (
          <TemplateBrowser
            cards={cards}
            isPending={templates.isPending}
            isError={templates.isError}
            errorMessage={
              templates.isError
                ? t('templates.loadFailed', {
                    error: automationErrorMessage(templates.error),
                  })
                : undefined
            }
            onRetry={() => void templates.refetch()}
            category={category}
            onCategoryChange={setCategory}
            query={query}
            onQueryChange={setQuery}
            viewerZone={viewerZone}
            locale={locale}
            onOpen={(slug) => {
              openedCard.current = slug;
              setStep({ kind: 'preview', slug });
            }}
          />
        )}
      </div>
    </Dialog>
  );
}

/** The catalog: a tab per category the catalog holds, the search, and a
 * card per template. Its tab and search are the dialog's, so they outlive
 * a preview. */
function TemplateBrowser({
  cards,
  isPending,
  isError,
  errorMessage,
  onRetry,
  category: chosen,
  onCategoryChange,
  query,
  onQueryChange,
  viewerZone,
  locale,
  onOpen,
}: {
  cards: readonly TemplateCard[];
  isPending: boolean;
  isError: boolean;
  errorMessage: string | undefined;
  onRetry: () => void;
  category: TemplateCategory | 'all';
  onCategoryChange: (category: TemplateCategory | 'all') => void;
  query: string;
  onQueryChange: (query: string) => void;
  viewerZone: string;
  locale: string;
  onOpen: (slug: string) => void;
}) {
  const { t } = useT('automations');
  // A tab the catalog does not hold — one a link asked for — shows all.
  const category =
    chosen === 'all' ||
    cards.length === 0 ||
    cards.some((card) => card.category === chosen)
      ? chosen
      : 'all';
  const sorted = useMemo(() => sortTemplates(cards, locale), [cards, locale]);
  const inCategory = useMemo(
    () =>
      category === 'all'
        ? sorted
        : sorted.filter((card) => card.category === category),
    [sorted, category],
  );
  const haystack = useCallback(
    (card: TemplateCard) => templateHaystack(card, locale),
    [locale],
  );
  const shown = useCatalogSearch(inCategory, query, haystack);
  const tabs = [
    { value: 'all', label: t('templates.all') },
    ...TEMPLATE_CATEGORY_ORDER.filter((entry) =>
      cards.some((card) => card.category === entry),
    ).map((entry) => ({ value: entry, label: categoryLabel(t, entry) })),
  ];

  return (
    <Stack gap={4}>
      <CatalogToolbar
        tabs={{
          items: tabs,
          value: category,
          onValueChange: (value) =>
            onCategoryChange(templateCategoryOf(value) ?? 'all'),
        }}
        search={{
          value: query,
          onChange: (event) => onQueryChange(event.target.value),
          placeholder: t('templates.search'),
        }}
      />
      <CatalogView
        isPending={isPending}
        isError={isError}
        {...(errorMessage !== undefined && { errorMessage })}
        onRetry={onRetry}
        items={shown}
        hasItems={cards.length > 0}
        itemKey={(card) => card.slug}
        renderItem={(card) => (
          // A box-less wrapper, so the card stays the grid's item: it only
          // names the card the way back focuses.
          <div className="contents" data-template-card={card.slug}>
            <TemplateCardView
              card={card}
              viewerZone={viewerZone}
              locale={locale}
              onOpen={onOpen}
            />
          </div>
        )}
        empty={{
          icon: LayoutTemplate,
          title: t('templates.none'),
        }}
        skeletonCards={6}
      />
    </Stack>
  );
}

/** One template as the catalog shows it: its product's logo, its name,
 * when it runs, what it does in one line, and whether it is in use or
 * needs a connection first. */
function TemplateCardView({
  card,
  viewerZone,
  locale,
  onOpen,
}: {
  card: TemplateCard;
  viewerZone: string;
  locale: string;
  onOpen: (slug: string) => void;
}) {
  const { t } = useT('automations');
  const { scheduleCompact } = useRecurrenceFormat();
  const words = templateWords(card, locale);
  const trigger = card.trigger;
  const runs =
    trigger === null
      ? t('templates.runsShort.manual')
      : trigger.kind === 'webhook'
        ? t('templates.runsShort.webhook')
        : trigger.kind === 'event'
          ? trigger.event !== null && isEmittedEventType(trigger.event)
            ? eventWords(trigger.event, t).label
            : t('templates.runsShort.event')
          : trigger.repeat !== null
            ? (() => {
                const compact = scheduleCompact(trigger.repeat);
                return compact.tail === undefined
                  ? compact.head
                  : `${compact.head} · ${compact.tail}`;
              })()
            : t('templates.runsShort.cron', { zone: viewerZone });
  const missing = missingConnectors(card).length > 0;

  return (
    <CatalogCard
      media={
        <CatalogCardIcon>
          <AutomationIcon icon={card.icon} className="size-6" />
        </CatalogCardIcon>
      }
      title={words.name}
      meta={
        <span className="text-muted-foreground line-clamp-1 text-xs leading-4">
          {runs}
        </span>
      }
      {...(words.description !== undefined && {
        description: words.description,
      })}
      {...(card.inUse > 0
        ? {
            badge: (
              <Badge variant="green">
                {t('templates.inUse', { count: card.inUse })}
              </Badge>
            ),
          }
        : missing
          ? {
              badge: (
                <Badge variant="yellow">{t('templates.connectFirst')}</Badge>
              ),
            }
          : {})}
      onClick={() => onOpen(card.slug)}
    />
  );
}
