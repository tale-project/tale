'use client';

import { Alert } from '@tale/ui/alert';
import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { CatalogLoadError } from '@tale/ui/catalog/catalog-view';
import { ConfigIcon } from '@tale/ui/catalog/config-icon';
import { CopyableField } from '@tale/ui/copyable-field';
import { Dialog } from '@tale/ui/dialog/dialog';
import { Stack } from '@tale/ui/layout';
import { SearchInput } from '@tale/ui/search-input';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { useNavigate } from '@tanstack/react-router';
import { ChevronRight, KeyRound } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { automationSlugToParam } from '@/lib/automations/slug';
import { useT } from '@/lib/i18n/client';

import { useAutomationTemplates } from '../hooks/queries';
import { automationErrorMessage } from '../lib/errors';
import {
  type StarterCard,
  starterMatches,
  starterWords,
} from '../lib/starters';
import {
  type StarterCreated,
  StarterSetupFields,
  useStarterSetup,
} from './starter-setup';
import { webhookBase } from './trigger-webhook-panel';

/**
 * "From a starter": the automations Tale ships ready to work, in ONE
 * dialog — the gallery, then the starter's few questions, then (for a
 * webhook starter) its address, shown once. The back control in the header
 * returns from the questions to the gallery, as adding a credential does;
 * on a phone the dialog is a sheet.
 *
 * Created in a project page, a starter's project question starts on that
 * project, and the automation opens there.
 */
export function StarterGalleryDialog({
  organizationId,
  projectId,
  open,
  onOpenChange,
}: {
  organizationId: string;
  projectId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useT('automations');
  const { i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en';
  const navigate = useNavigate();
  const [picked, setPicked] = useState<StarterCard | null>(null);
  const [minted, setMinted] = useState<StarterCreated | null>(null);

  useEffect(() => {
    if (!open) return;
    setPicked(null);
    setMinted(null);
  }, [open]);

  const openAutomation = (created: StarterCreated): void => {
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

  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const setup = useStarterSetup({
    organizationId,
    card: picked,
    locale,
    ...(projectId !== undefined && { projectId }),
    onCreated: (created) => {
      if (created.token !== undefined) {
        setMinted(created);
        return;
      }
      openAutomation(created);
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Closing the address screen any way still lands on the automation —
        // the address is gone from the page either way.
        if (!next && minted !== null) {
          openAutomation(minted);
          return;
        }
        onOpenChange(next);
      }}
      size="lg"
      title={
        minted !== null
          ? t('starters.webhookTitle')
          : picked !== null
            ? starterWords(picked, locale).name
            : t('starters.title')
      }
      description={
        minted !== null
          ? t('blank.stepWebhook')
          : picked !== null
            ? t('starters.setupDescription')
            : t('starters.description')
      }
      // The gallery scrolls inside a stable frame; the questions size to
      // themselves.
      className={
        picked === null && minted === null
          ? 'md:h-[70dvh] md:max-h-[70dvh]'
          : undefined
      }
      {...(picked !== null && minted === null
        ? {
            onBack: () => setPicked(null),
            backLabel: t('starters.backToGallery'),
            backDisabled: setup?.submitting === true,
          }
        : {})}
      footer={
        minted !== null ? (
          <Button type="button" onClick={() => openAutomation(minted)}>
            {t('blank.openAutomation')}
          </Button>
        ) : setup !== null ? (
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
              type="submit"
              form={setup.formId}
              disabled={!setup.canSubmit}
              {...(!setup.canSubmit &&
                setup.disabledReason !== undefined && {
                  disabledReason: setup.disabledReason,
                })}
              isLoading={setup.submitting}
            >
              {setup.submitting ? t('blank.submitting') : t('starters.create')}
            </Button>
          </>
        ) : undefined
      }
    >
      {minted !== null && minted.token !== undefined ? (
        <Stack gap={4}>
          <Alert
            variant="warning"
            icon={KeyRound}
            title={t('trigger.tokenTitle')}
            description={t('trigger.tokenHint')}
          />
          <CopyableField
            label={t('trigger.webhookEndpointLabel')}
            value={`${webhookBase(origin, minted.projectId)}${minted.token}`}
            mono
            copyAriaLabel={t('blank.copyWebhookUrl')}
            description={t('trigger.webhook.sampleEnv')}
          />
        </Stack>
      ) : picked !== null && setup !== null ? (
        <StarterSetupFields
          organizationId={organizationId}
          card={picked}
          setup={setup}
          locale={locale}
        />
      ) : (
        <StarterPicker
          organizationId={organizationId}
          locale={locale}
          open={open}
          onPick={setPicked}
        />
      )}
    </Dialog>
  );
}

/** The gallery: every starter, searchable, each a row that opens its
 * questions. */
function StarterPicker({
  organizationId,
  locale,
  open,
  onPick,
}: {
  organizationId: string;
  locale: string;
  open: boolean;
  onPick: (card: StarterCard) => void;
}) {
  const { t } = useT('automations');
  const { t: tSkeleton } = useT('skeleton');
  const templates = useAutomationTemplates(organizationId, open);
  const [query, setQuery] = useState('');
  const cards = useMemo(
    () => templates.data?.templates ?? [],
    [templates.data],
  );
  // In the order of their names as the reader reads them.
  const shown = useMemo(
    () =>
      cards
        .filter((card) => starterMatches(card, query, locale))
        .sort((left, right) =>
          starterWords(left, locale).name.localeCompare(
            starterWords(right, locale).name,
            locale,
          ),
        ),
    [cards, query, locale],
  );

  if (templates.isPending) {
    return (
      <Skeletonize loading label={tSkeleton('loading')}>
        <Stack gap={4} className="min-h-0 flex-1">
          <SkeletonBox className="h-10 w-full">&nbsp;</SkeletonBox>
          <Stack gap={2}>
            <SkeletonBox className="h-16 w-full">&nbsp;</SkeletonBox>
            <SkeletonBox className="h-16 w-full">&nbsp;</SkeletonBox>
            <SkeletonBox className="h-16 w-full">&nbsp;</SkeletonBox>
          </Stack>
        </Stack>
      </Skeletonize>
    );
  }
  if (templates.isError) {
    return (
      <CatalogLoadError
        message={t('starters.loadFailed', {
          error: automationErrorMessage(templates.error),
        })}
        onRetry={() => void templates.refetch()}
      />
    );
  }

  return (
    <Stack gap={4} className="min-h-0 flex-1">
      <SearchInput
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t('starters.search')}
        aria-label={t('starters.search')}
        className="max-w-none"
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {cards.length === 0 ? (
          <Alert variant="warning" description={t('starters.none')} />
        ) : shown.length === 0 ? (
          <Text as="p" variant="muted" className="px-1 py-6 text-sm">
            {t('starters.noMatches')}
          </Text>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {shown.map((card) => {
              const words = starterWords(card, locale);
              const needsSetup = card.connectors.some(
                (connector) => !connector.connected,
              );
              return (
                <li
                  key={card.slug}
                  className="border-border overflow-hidden rounded-lg border"
                >
                  <button
                    type="button"
                    onClick={() => onPick(card)}
                    className="hover:bg-accent focus-visible:ring-ring flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors focus-visible:ring-1 focus-visible:outline-none"
                  >
                    <ConfigIcon
                      icon={
                        card.icon === undefined
                          ? undefined
                          : `lucide:${card.icon}`
                      }
                      className="text-muted-foreground mt-0.5 size-5 shrink-0"
                    />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="text-foreground text-sm font-medium">
                        {words.name}
                      </span>
                      {words.description !== undefined && (
                        <span className="text-muted-foreground text-xs">
                          {words.description}
                        </span>
                      )}
                      {needsSetup && (
                        <Badge variant="outline" className="mt-1 w-fit">
                          {t('starters.needsSetup')}
                        </Badge>
                      )}
                    </span>
                    <ChevronRight
                      aria-hidden
                      className="text-muted-foreground mt-0.5 size-4 shrink-0"
                    />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Stack>
  );
}
