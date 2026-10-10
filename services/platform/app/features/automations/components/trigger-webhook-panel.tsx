'use client';

import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { CodeBlock } from '@tale/ui/code-block';
import { CopyableField } from '@tale/ui/copyable-field';
import { InlineCode } from '@tale/ui/inline-code';
import { SKELETON_PULSE } from '@tale/ui/skeleton';
import { Text } from '@tale/ui/text';
import { useFocusHandoff } from '@tale/ui/use-focus-handoff';
import { useFormatDate } from '@tale/ui/use-format-date';
import { KeyRound } from 'lucide-react';
import { useId, useRef } from 'react';

import { useT } from '@/lib/i18n/client';

import { useAutomationTriggerRuns } from '../hooks/queries';
import { readRunStatus } from '../lib/run-view';
import { RunBadge } from './run-status-badge';
import { type TriggerPlace, TriggerRunLink } from './trigger-links';

/** A project the automation is installed in. */
export interface BoundProject {
  _id: string;
  name: string;
}

/** Where a webhook answers: one address per installed project, or the
 * organization's when it is installed in none. */
interface WebhookAddress {
  key: string;
  /** The project's name; undefined for the organization's address. */
  project: string | undefined;
  /** The address up to the token. */
  base: string;
}

/** The token's stand-in while it is not known. */
const MASK = '••••••••';

/** How many deliveries the list shows. */
const DELIVERY_LIMIT = 10;

/**
 * The addresses a webhook answers on: one per project it is installed in —
 * the route's own project first — or the organization's when it is
 * installed in none (an installed automation runs only through a project).
 */
export function webhookAddresses(
  origin: string,
  projects: readonly BoundProject[],
  routeProjectId: string | undefined,
): WebhookAddress[] {
  if (projects.length === 0) {
    return [
      { key: 'org', project: undefined, base: webhookBase(origin, undefined) },
    ];
  }
  return projects
    .toSorted(
      (a, b) =>
        Number(b._id === routeProjectId) - Number(a._id === routeProjectId),
    )
    .map((project) => ({
      key: project._id,
      project: project.name,
      base: webhookBase(origin, project._id),
    }));
}

/** A webhook's address up to its token: a project's door, or the
 * organization's. */
export function webhookBase(
  origin: string,
  projectId: string | undefined,
): string {
  return projectId === undefined
    ? `${origin}/api/automations/webhook/`
    : `${origin}/api/projects/${projectId}/automations/webhook/`;
}

/** The test request, with the URL in the sender's environment unless a
 * freshly minted one is at hand. */
export function sampleRequest(url: string | null): string {
  return [
    `curl --fail-with-body --request POST "${url ?? '$TALE_WEBHOOK_URL'}" \\`,
    `  --header 'Content-Type: application/json' \\`,
    `  --header 'Idempotency-Key: <one-id-per-event>' \\`,
    `  --data '{"example": true}'`,
  ].join('\n');
}

/**
 * A webhook trigger's own block on the General tab: where it answers, how
 * to send it a test request, and the deliveries it recently started runs
 * for. The token is the URL's last part and is shown once — right after it
 * is minted, when each address is copyable; after that the addresses show
 * it masked, and **Rotate token** mints a new one.
 */
export function TriggerWebhookPanel({
  place,
  origin,
  projects,
  mintedToken,
  hasToken,
  storedWebhook,
  canEdit,
  rotating,
  onRotate,
}: {
  place: TriggerPlace;
  /** The deployment's origin, which external senders call. */
  origin: string;
  /** The projects the automation is installed in, by name. */
  projects: readonly BoundProject[];
  /** The token the last save or rotation minted, shown once. */
  mintedToken: string | null;
  /** The stored webhook has a token. */
  hasToken: boolean;
  /** The stored trigger is this webhook, so its deliveries can be read. */
  storedWebhook: boolean;
  canEdit: boolean;
  rotating: boolean;
  onRotate: () => void;
}) {
  const { t } = useT('automations');
  const addresses = webhookAddresses(origin, projects, place.projectId);
  const installed = projects.length > 0;
  const titleId = useId();
  const firstUrl =
    mintedToken === null ? null : `${addresses[0]?.base ?? ''}${mintedToken}`;

  return (
    <div className="flex flex-col gap-4">
      {mintedToken !== null ? (
        <Alert
          variant="warning"
          icon={KeyRound}
          title={t('trigger.tokenTitle')}
          description={
            <span className="flex flex-col gap-3">
              <span>{t('trigger.tokenHint')}</span>
              {addresses.map((address) => (
                <CopyableField
                  key={address.key}
                  label={address.project ?? t('trigger.webhookEndpointLabel')}
                  value={`${address.base}${mintedToken}`}
                />
              ))}
            </span>
          }
        />
      ) : (
        <div className="flex flex-col gap-2">
          <Text as="h3" id={titleId} className="text-sm font-medium">
            {installed
              ? t('trigger.webhook.projectUrls')
              : t('trigger.webhookEndpointLabel')}
          </Text>
          {hasToken ? (
            <ul aria-labelledby={titleId} className="flex flex-col gap-2">
              {addresses.map((address) => (
                <li key={address.key} className="flex min-w-0 flex-col gap-0.5">
                  {address.project !== undefined && (
                    <Text as="span" variant="muted" className="text-xs">
                      {address.project}
                    </Text>
                  )}
                  <span>
                    <span className="sr-only">
                      {t('trigger.webhook.tokenHidden')}
                    </span>
                    <InlineCode aria-hidden="true" className="break-all">
                      {`${address.base}${MASK}`}
                    </InlineCode>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <Text as="p" variant="muted" className="text-xs">
              {t('trigger.noToken')}
            </Text>
          )}
          {hasToken && (
            <Text as="p" variant="muted" className="text-xs">
              {t('trigger.webhook.tokenHiddenHint')}
            </Text>
          )}
          {canEdit && hasToken && (
            <div>
              <Button
                size="sm"
                variant="secondary"
                icon={KeyRound}
                isLoading={rotating}
                onClick={onRotate}
              >
                {t('trigger.rotate')}
              </Button>
            </div>
          )}
        </div>
      )}
      {installed && (
        <Text as="p" variant="muted" className="text-xs">
          {t('trigger.webhook.orgUnused')}
        </Text>
      )}

      <div className="flex flex-col gap-2">
        <Text as="h3" className="text-sm font-medium">
          {t('trigger.webhook.sampleTitle')}
        </Text>
        <CodeBlock
          copyValue={sampleRequest(firstUrl)}
          copyLabel={t('trigger.webhook.sampleCopy')}
        >
          {sampleRequest(firstUrl)}
        </CodeBlock>
        <Text as="p" variant="muted" className="text-xs">
          {t('trigger.webhook.sampleHint')}
        </Text>
        <Text as="p" variant="muted" className="text-xs">
          {t('trigger.webhook.sampleEnv')}
        </Text>
      </div>

      {storedWebhook && hasToken && <TriggerDeliveries place={place} />}
    </div>
  );
}

/**
 * The runs the webhook recently started, newest first, each with how the
 * door recognised its delivery while it still can (by the sender's
 * delivery id, or by its body) and the run's state. A request the door
 * refused started no run, so it is not here: its sender saw why.
 */
function TriggerDeliveries({ place }: { place: TriggerPlace }) {
  const { t } = useT('automations');
  const { formatDate, formatDateSmart } = useFormatDate();
  const titleRef = useRef<HTMLElement>(null);
  const titleId = useId();
  const runs = useAutomationTriggerRuns(
    place.organizationId,
    place.name,
    DELIVERY_LIMIT,
  );
  // Try again unmounts once the read answers; focus goes to the title.
  const retryRef = useFocusHandoff<HTMLDivElement>(() =>
    titleRef.current?.focus(),
  );

  let body;
  if (runs.isPending) {
    body = (
      <div aria-hidden="true" className="flex flex-col gap-2">
        {[0, 1, 2].map((row) => (
          <span
            key={row}
            className={`block h-5 rounded-md ${SKELETON_PULSE}`}
          />
        ))}
      </div>
    );
  } else if (runs.isError) {
    body = (
      <div ref={retryRef}>
        <Alert
          variant="destructive"
          description={t('trigger.webhook.deliveries.loadFailed')}
        >
          <div className="pt-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void runs.refetch()}
            >
              {t('trigger.retry')}
            </Button>
          </div>
        </Alert>
      </div>
    );
  } else if ((runs.data ?? []).length === 0) {
    body = (
      <Text as="p" variant="muted" className="text-xs">
        {t('trigger.webhook.deliveries.empty')}
      </Text>
    );
  } else {
    body = (
      <ul aria-labelledby={titleId} className="flex flex-col gap-1.5">
        {(runs.data ?? []).map((run) => (
          <li
            key={run.runId}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-sm"
          >
            <span className="min-w-0">
              <time
                dateTime={new Date(run.startedAt).toISOString()}
                title={formatDate(new Date(run.startedAt), 'long')}
              >
                {formatDateSmart(new Date(run.startedAt), 'long')}
              </time>
              {run.deliverySource !== null && (
                <Text as="span" variant="muted" className="text-xs">
                  {' · '}
                  {run.deliverySource === 'header' && run.header !== null
                    ? t('trigger.webhook.deliveries.byHeader', {
                        header: run.header,
                      })
                    : t('trigger.webhook.deliveries.byBody')}
                </Text>
              )}
            </span>
            <span className="flex items-center gap-2">
              <RunBadge status={readRunStatus(run.status)} />
              <TriggerRunLink place={place} runId={run.runId}>
                {t('trigger.failures.viewRun')}
              </TriggerRunLink>
            </span>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-2">
      <Text
        as="h3"
        id={titleId}
        ref={titleRef}
        tabIndex={-1}
        className="text-sm font-medium focus-visible:outline-none"
      >
        {t('trigger.webhook.deliveries.title')}
      </Text>
      {body}
      <Text as="p" variant="muted" className="text-xs">
        {t('trigger.webhook.deliveries.refusedNote')}
      </Text>
    </section>
  );
}
