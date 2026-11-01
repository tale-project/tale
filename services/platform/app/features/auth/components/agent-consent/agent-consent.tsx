import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { Input } from '@tale/ui/input';
import { Stack } from '@tale/ui/layout';
import { PermissionSummary } from '@tale/ui/permission-summary';
import { Text } from '@tale/ui/text';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useMemo, useState } from 'react';

import { useConfirmPassword } from '@/app/features/auth/hooks/use-confirm-password';
import { isSessionFresh } from '@/app/lib/auth/session-freshness';
import { sessionQueryOptions } from '@/app/lib/auth/session-query';
import {
  agentConsentContextQuery,
  isRetryableFailure,
} from '@/app/lib/backend/agent-connections';
import { BackendApiError } from '@/app/lib/backend/api-client';
import { authClient } from '@/lib/auth-client';
import { useT } from '@/lib/i18n/client';
import {
  needsFreshSession,
  type OfferedScope,
} from '@/lib/shared/agent-access';

import { AuthFormLayout } from '../auth-form-layout';
import { AuthPageLayout } from '../auth-page-layout';
import { AgentAccessPicker } from './agent-access-picker';
import {
  AgentClientMark,
  AgentClientProvenance,
} from './agent-client-identity';
import {
  forgetChoice,
  rememberChoice,
  rememberedChoice,
} from './agent-consent-memory';
import {
  type AccessChoice,
  chosenScopes,
  type ConsentOffer,
  defaultOrganizationId,
  initialChoice,
  isChoiceOnOffer,
  summaryOf,
} from './agent-consent-model';
import {
  isExpired,
  readAgentConsentRequest,
  redirectPlaceOf,
} from './agent-consent-request';
import { AgentOrganizationPicker } from './agent-organization-picker';

/** The consent endpoint, under the auth client's base path. */
const CONSENT_PATH = '/oauth2/consent';

/** The code a refusal of the consent endpoint carries, when it carries one. */
function refusalCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const { code } = error;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

/**
 * The consent page for a coding agent: who is asking, which organization it
 * will work in, how much access to give, and what that comes to — decided
 * here, by the person, and judged again by the server when they connect.
 *
 * The signed request is passed on whole, byte for byte, to the consent
 * endpoint; the page reads from it only what it shows. What the person may
 * choose comes from the server (`consent-context`), so the page never offers
 * what the server would refuse, and an access beyond reading and reading
 * settings asks for the password again when the sign-in is more than a day
 * old.
 */
export function AgentConsent({ email }: { email: string }) {
  const { t } = useT('agentConnections');
  const { t: tTwoFactor } = useT('twoFactor');
  const { t: tAuth } = useT('auth');
  const request = useMemo(
    () => readAgentConsentRequest(window.location.search),
    [],
  );
  const [openedAt] = useState(() => Date.now());
  const expired = isExpired(request, openedAt);
  const redirect = useMemo(
    () => redirectPlaceOf(request.redirectUri),
    [request.redirectUri],
  );

  const contextQuery = useQuery({
    ...agentConsentContextQuery({
      clientId: request.clientId,
      scope: request.scope,
    }),
    enabled: !expired,
  });
  const context = contextQuery.data;
  const { data: sessionResult } = useQuery(sessionQueryOptions);
  const createdAt = sessionResult?.data?.session.createdAt;
  // What the server or a confirmation just said about the session, which
  // beats reading its age.
  const [sessionKnownFresh, setSessionKnownFresh] = useState<boolean | null>(
    null,
  );
  // An age not read yet asks nothing up front: the server's answer decides.
  const sessionFresh =
    sessionKnownFresh ??
    (createdAt === undefined || isSessionFresh(createdAt, openedAt));

  const confirmation = useConfirmPassword({
    onConfirmed: () => setSessionKnownFresh(true),
  });

  // What the person chose before confirming their password, which reloads
  // the page under them with the request signed anew.
  const remembered = useMemo(() => rememberedChoice(request), [request]);
  useEffect(() => {
    forgetChoice(request);
  }, [request]);
  // The person's explicit choices; until they choose, the page's own.
  const [chosenOrganization, setChosenOrganization] = useState<string | null>(
    remembered?.organizationId ?? null,
  );
  const [choices, setChoices] = useState<
    Readonly<Record<string, AccessChoice>>
  >(
    remembered === null
      ? {}
      : { [remembered.organizationId]: remembered.choice },
  );
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const organizations = context?.organizations ?? [];
  const organizationId =
    chosenOrganization !== null &&
    organizations.some((entry) => entry.id === chosenOrganization)
      ? chosenOrganization
      : context === undefined
        ? null
        : defaultOrganizationId(organizations, context.activeOrganizationId);
  const organization = organizations.find(
    (entry) => entry.id === organizationId,
  );
  const offer: ConsentOffer | null = useMemo(
    () =>
      context === undefined || organization === undefined
        ? null
        : {
            requested: new Set(context.requestedScopes),
            ceiling: new Set(organization.ceiling),
          },
    [context, organization],
  );
  // A choice made or kept holds only while the offer still allows it.
  const made =
    organization === undefined ? undefined : choices[organization.id];
  const choice: AccessChoice | null =
    organization === undefined || offer === null
      ? null
      : made !== undefined && isChoiceOnOffer(made, offer)
        ? made
        : initialChoice(offer, organization.previous);
  const scopes = choice === null ? [] : chosenScopes(choice);
  const mustConfirm = needsFreshSession(scopes) && !sessionFresh;

  const confirmId = useId();

  /** Confirming the password, or signing in again, replaces the session and
   * with it the page: keep what was chosen for the page that follows. */
  function keepChoice() {
    if (organization !== undefined && choice !== null) {
      rememberChoice(request, { organizationId: organization.id, choice });
    }
  }

  async function connect() {
    if (organization === undefined || choice === null) return;
    setBusy(true);
    setProblem(null);
    try {
      const answer = await authClient.$fetch<{ url?: string }>(CONSENT_PATH, {
        method: 'POST',
        body: {
          accept: true,
          oauth_query: request.query,
          scope: scopes.join(' '),
          tale: { organizationId: organization.id },
        },
      });
      if (!answer.error && typeof answer.data?.url === 'string') {
        // The auth client follows the redirect it was given: stay busy
        // until the page is left.
        return;
      }
      const code = refusalCode(answer.error);
      if (code === 'SESSION_NOT_FRESH') setSessionKnownFresh(false);
      setProblem(messageFor(code));
    } catch (failure) {
      console.warn('[agent-consent] connecting failed', failure);
      setProblem(t('consent.errors.failed'));
    }
    setBusy(false);
  }

  async function cancel() {
    setBusy(true);
    setProblem(null);
    try {
      const answer = await authClient.oauth2.consent({
        accept: false,
        oauth_query: request.query,
      });
      if (!answer.error && typeof answer.data?.url === 'string') return;
    } catch (failure) {
      console.warn('[agent-consent] cancelling failed', failure);
    }
    setProblem(t('consent.errors.failed'));
    setBusy(false);
  }

  /** The words for what the server refused with. Each key is named in full,
   * so the catalog's checks can find it. */
  function messageFor(code: string | undefined): string {
    switch (code) {
      case 'AGENT_CONSENT_ORG_REQUIRED':
        return t('consent.errors.orgRequired');
      case 'ORG_FORBIDDEN':
        return t('consent.errors.notMember');
      case 'IDENTITY_NOT_ELIGIBLE':
        return t('consent.errors.notEligible');
      case 'AGENT_CONNECT_FORBIDDEN':
        return t('consent.organization.notAllowed');
      case 'AGENT_SCOPE_NOT_ALLOWED':
        return t('consent.errors.scopeNotAllowed');
      case 'SESSION_NOT_FRESH':
        return t('consent.errors.notFresh');
      case 'AGENT_CONNECTION_UNAVAILABLE':
        return t('consent.errors.unavailable');
      default:
        return t('consent.errors.failed');
    }
  }

  /** The name of each scope the page offers as it words it; a scope without
   * one does not compile. */
  const scopeLabels = {
    'tale:mcp': t('scopes.mcp'),
    'tale:automations.write': t('scopes.automationsWrite'),
    'tale:automations.deploy': t('scopes.automationsDeploy'),
    'tale:settings.read': t('scopes.settingsRead'),
    'tale:settings.write': t('scopes.settingsWrite'),
  } satisfies Record<OfferedScope, string>;

  // What stands in the way before anything is chosen.
  const loadFailure =
    contextQuery.error instanceof BackendApiError &&
    contextQuery.error.status === 403 &&
    contextQuery.error.code === 'ORG_FORBIDDEN'
      ? t('consent.errors.scopedSession')
      : contextQuery.isError
        ? t('consent.errors.clientUnavailable')
        : null;
  const blocked = expired
    ? t('consent.errors.expired')
    : loadFailure !== null
      ? loadFailure
      : context !== undefined && !context.eligible
        ? t('consent.errors.notEligible')
        : null;
  const loading = !expired && context === undefined && loadFailure === null;
  // The app's details could not be read because the server or the network
  // failed, which asking again can change; an answer that refused is final.
  const canRetry =
    !expired && contextQuery.isError && isRetryableFailure(contextQuery.error);
  const nothingAllowed =
    context !== undefined && context.eligible && organizationId === null;
  // A choice exists only for an organization the person may connect to.
  const canConnect =
    !busy && !mustConfirm && blocked === null && choice !== null && !expired;

  const title = context
    ? t('consent.title', { client: context.client.name })
    : tAuth('oauth.title');

  return (
    <AuthPageLayout>
      <AuthFormLayout
        title={title}
        {...(context !== undefined
          ? { mark: <AgentClientMark client={context.client} /> }
          : {})}
      >
        <Stack gap={6}>
          {context !== undefined ? (
            <Stack gap={1}>
              <Text className="wrap-anywhere">
                {t('consent.lead', { client: context.client.name })}
              </Text>
              <Text variant="muted" className="break-words">
                {t('consent.account', { email })}
              </Text>
            </Stack>
          ) : null}
          {context !== undefined ? (
            <AgentClientProvenance
              client={context.client}
              redirect={redirect}
            />
          ) : null}
          {loading ? <Text role="status">{t('consent.loading')}</Text> : null}
          {blocked !== null ? (
            <Alert variant="destructive" description={blocked} />
          ) : null}
          {context !== undefined && blocked === null ? (
            <>
              {nothingAllowed ? (
                <Alert
                  variant="warning"
                  description={t('consent.organization.none')}
                />
              ) : null}
              {organizations.length > 0 ? (
                <AgentOrganizationPicker
                  organizations={organizations}
                  value={organizationId}
                  disabled={busy}
                  onChange={setChosenOrganization}
                />
              ) : null}
              {organization !== undefined &&
              offer !== null &&
              choice !== null ? (
                <>
                  <AgentAccessPicker
                    offer={offer}
                    choice={choice}
                    organizationName={organization.name}
                    disabled={busy}
                    onChange={(next) =>
                      setChoices((current) => ({
                        ...current,
                        [organization.id]: next,
                      }))
                    }
                  />
                  <PermissionSummary
                    aria-live="polite"
                    title={t('consent.summary.title', {
                      client: context.client.name,
                    })}
                    items={summaryOf(choice, offer).map((line) =>
                      line.why === 'roleCannot'
                        ? {
                            label: scopeLabels[line.scope],
                            allowed: line.allowed,
                            detail: t('consent.access.roleCannot', {
                              organization: organization.name,
                            }),
                          }
                        : {
                            label: scopeLabels[line.scope],
                            allowed: line.allowed,
                          },
                    )}
                    footer={t('consent.access.summary', {
                      organization: organization.name,
                    })}
                  />
                  <Text variant="caption">{t('consent.duration')}</Text>
                </>
              ) : null}
              {mustConfirm ? (
                <div role="group" aria-labelledby={confirmId}>
                  <Stack gap={3}>
                    <Text id={confirmId} variant="label">
                      {t('consent.fresh.title')}
                    </Text>
                    {confirmation.passwordless ? (
                      <>
                        <Text variant="muted">
                          {t('consent.fresh.ssoOnly')}
                        </Text>
                        <Button
                          variant="secondary"
                          fullWidth
                          disabled={confirmation.submitting}
                          onClick={() => {
                            keepChoice();
                            void confirmation.signInAgain();
                          }}
                        >
                          {t('consent.fresh.signInAgain')}
                        </Button>
                      </>
                    ) : (
                      <>
                        <Text variant="muted">{t('consent.fresh.body')}</Text>
                        <Input
                          type="password"
                          autoComplete="current-password"
                          label={tTwoFactor('confirmPassword.label')}
                          value={confirmation.password}
                          onChange={(event) =>
                            confirmation.setPassword(event.target.value)
                          }
                          onKeyDown={(event) => {
                            if (
                              event.key === 'Enter' &&
                              confirmation.password !== '' &&
                              !confirmation.submitting
                            ) {
                              event.preventDefault();
                              keepChoice();
                              void confirmation.confirm();
                            }
                          }}
                          disabled={confirmation.submitting}
                          errorMessage={confirmation.error ?? undefined}
                        />
                        <Button
                          variant="secondary"
                          fullWidth
                          disabled={
                            confirmation.submitting ||
                            confirmation.password === ''
                          }
                          onClick={() => {
                            keepChoice();
                            void confirmation.confirm();
                          }}
                        >
                          {tTwoFactor('confirmPassword.submit')}
                        </Button>
                      </>
                    )}
                  </Stack>
                </div>
              ) : null}
            </>
          ) : null}
          {problem !== null ? (
            <Alert variant="destructive" description={problem} />
          ) : null}
          {!expired ? (
            <Stack gap={2}>
              {canRetry ? (
                <Button fullWidth onClick={() => void contextQuery.refetch()}>
                  {tAuth('oauth.retry')}
                </Button>
              ) : (
                <Button
                  fullWidth
                  disabled={!canConnect}
                  aria-describedby={mustConfirm ? confirmId : undefined}
                  onClick={() => void connect()}
                >
                  {busy ? t('consent.connecting') : t('consent.connect')}
                </Button>
              )}
              <Button
                variant="secondary"
                fullWidth
                disabled={busy}
                onClick={() => void cancel()}
              >
                {t('consent.cancel')}
              </Button>
            </Stack>
          ) : null}
        </Stack>
      </AuthFormLayout>
    </AuthPageLayout>
  );
}
