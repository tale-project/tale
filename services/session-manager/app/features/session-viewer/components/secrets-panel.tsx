import { Button, LinkButton } from '@tale/ui/button';
import { CatalogLoadError } from '@tale/ui/catalog/catalog-view';
import { EmptyState } from '@tale/ui/empty-state';
import { Heading } from '@tale/ui/heading';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { SubPanelSectionHeader } from '@tale/ui/sub-panel-list';
import { Text } from '@tale/ui/text';
import { KeyRound, Plus } from 'lucide-react';
import { useEffect, useMemo, useRef, type KeyboardEvent } from 'react';

import { useSecretLabels } from '@/app/features/secrets/hooks/use-secret-labels';
import { useMeta } from '@/app/hooks/use-meta';
import { useQuoted } from '@/app/hooks/use-quoted';
import { readFailureText } from '@/app/lib/api/failure';
import { useT } from '@/lib/i18n/client';

import { useSessionSecrets } from '../hooks/use-session-secrets';
import { groupSecrets } from '../lib/group-secrets';
import { SecretItem } from './secret-item';

interface SecretsPanelProps {
  sessionId: number;
  /** The name of the session, for the button that adds a secret for it. */
  sessionName: string;
  /** The id of the heading, which names the popover. */
  headingId: string;
  /** Types a value into the page. */
  onType: (text: string) => void;
  /** Adds a secret for this session. */
  onAdd: () => void;
}

/**
 * Arrow keys, Home and End move between the secrets of the list, as they do
 * between the options of a list in the page: round the ends. Tab still goes
 * through every control, so nothing here is needed to reach one.
 */
function moveBetweenRows(event: KeyboardEvent<HTMLElement>) {
  const { target, currentTarget, key } = event;
  if (
    !(target instanceof HTMLElement) ||
    !target.hasAttribute('data-secret-row')
  ) {
    return;
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(key)) return;
  const rows = [
    ...currentTarget.querySelectorAll<HTMLElement>('[data-secret-row]'),
  ];
  const step = key === 'ArrowDown' ? 1 : -1;
  const at = rows.indexOf(target);
  const next =
    key === 'Home'
      ? 0
      : key === 'End'
        ? rows.length - 1
        : (at + step + rows.length) % rows.length;
  event.preventDefault();
  rows[next]?.focus();
}

/** Rows of the shape the list has, while the list is read. */
function LoadingList({ label }: { label: string }) {
  return (
    <Skeletonize loading label={label} className="p-1">
      <div className="flex h-7 items-center px-2">
        <SkeletonBox>
          <span className="inline-block h-3 w-24" />
        </SkeletonBox>
      </div>
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex items-start gap-2.5 px-2 py-1.5">
          <SkeletonBox>
            <span className="inline-block size-5" />
          </SkeletonBox>
          <div className="flex min-w-0 flex-col gap-1">
            <SkeletonBox>
              <span className="inline-block h-4 w-32" />
            </SkeletonBox>
            <SkeletonBox>
              <span className="inline-block h-3 w-48" />
            </SkeletonBox>
          </div>
        </div>
      ))}
    </Skeletonize>
  );
}

/**
 * What the popover holds: a heading that stays, the list of secrets, which is
 * what scrolls (its groups' names stay at its top while their secrets go by),
 * and a foot that stays, with the ways on: add a secret here, or manage them on
 * the Secrets page.
 */
export function SecretsPanel({
  sessionId,
  sessionName,
  headingId,
  onType,
  onAdd,
}: SecretsPanelProps) {
  const { t } = useT('viewer');
  const { t: tErrors } = useT('errors');
  const { quoted } = useQuoted();
  const labels = useSecretLabels();
  const secrets = useSessionSecrets(sessionId);
  const meta = useMeta();
  const kinds = meta.data?.secretKinds;
  const groups = useMemo(
    () => groupSecrets(secrets.data ?? [], kinds ?? []),
    [secrets.data, kinds],
  );
  const empty = secrets.data !== undefined && secrets.data.length === 0;
  const list = useRef<HTMLDivElement>(null);

  // The popover opens with the keyboard on itself, while the list is read.
  // Once the list is there it goes to the first secret, where Tab would take
  // it next, unless the person moved it to something else meanwhile.
  const loaded = secrets.data !== undefined;
  useEffect(() => {
    if (!loaded) return;
    const popover = list.current?.parentElement;
    if (
      popover !== null &&
      popover !== undefined &&
      document.activeElement === popover
    ) {
      list.current?.querySelector<HTMLElement>('[data-secret-row]')?.focus();
    }
  }, [loaded]);

  return (
    <>
      <div className="border-border shrink-0 border-b px-4 pt-3 pb-2.5">
        <Heading id={headingId} level={2} size="sm">
          {t('secrets.title')}
        </Heading>
        <Text variant="caption" className="mt-0.5">
          {t('secrets.hint')}
        </Text>
      </div>
      {/* The rows are the one stop of each secret and have heard a key before
          it gets here: the list only moves the keyboard between them. */}
      <div
        ref={list}
        role="presentation"
        onKeyDown={moveBetweenRows}
        // It grows to a height of its own, then scrolls inside the popover.
        className="max-h-96 min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        {secrets.isPending && <LoadingList label={t('secrets.loading')} />}
        {secrets.isError && (
          <div className="p-2">
            <CatalogLoadError
              message={readFailureText(
                t('secrets.loadFailed'),
                secrets.error,
                tErrors,
              )}
              onRetry={() => void secrets.refetch()}
              isRetrying={secrets.isFetching}
            />
          </div>
        )}
        {empty && (
          <EmptyState
            icon={KeyRound}
            title={t('secrets.empty')}
            description={t('secrets.emptyHint')}
            className="px-6 py-8"
          />
        )}
        {groups.map((group) => (
          <section
            key={group.kind}
            aria-label={labels.kind(group.kind)}
            className="pb-1"
          >
            {/* Named by the region around it: read once. Stays at the top
                while the secrets of its group go by. */}
            <div
              aria-hidden="true"
              className="bg-popover dark:bg-muted sticky top-0 z-10"
            >
              <SubPanelSectionHeader
                label={labels.kind(group.kind)}
                className="px-3"
              />
            </div>
            <ul className="flex flex-col gap-0.5 px-1">
              {group.secrets.map((secret) => (
                <SecretItem key={secret.id} secret={secret} onType={onType} />
              ))}
            </ul>
          </section>
        ))}
      </div>
      {(empty || groups.length > 0) && (
        <div className="border-border flex shrink-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 border-t p-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            icon={Plus}
            iconClassName="shrink-0"
            onClick={onAdd}
            className="max-w-full min-w-0 px-2"
          >
            <span className="truncate">
              {t('secrets.add', { name: quoted(sessionName) })}
            </span>
          </Button>
          {/* To change or delete one: the Secrets page has the rest. */}
          {!empty && (
            <LinkButton
              href="/secrets"
              variant="ghost"
              size="sm"
              className="px-2"
            >
              {t('secrets.manage')}
            </LinkButton>
          )}
        </div>
      )}
    </>
  );
}
