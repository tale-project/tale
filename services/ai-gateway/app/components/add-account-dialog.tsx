import { Button } from '@tale/ui/button';
import { CopyableField } from '@tale/ui/copyable-field';
import { Dialog } from '@tale/ui/dialog/dialog';
import { ExternalLink } from '@tale/ui/external-link';
import { Input } from '@tale/ui/input';
import { Select } from '@tale/ui/select';
import { Text } from '@tale/ui/text';
import { Textarea } from '@tale/ui/textarea';
import { useToast } from '@tale/ui/use-toast';
import { LoaderCircle } from 'lucide-react';
import { useEffect, useEffectEvent, useState } from 'react';

import {
  ApiError,
  gatewayApi,
  isProviderId,
  type AccountView,
  type AuthorizationStart,
  type ProviderId,
} from '@/app/lib/api';
import { authorizationErrorKey } from '@/app/lib/authorization-errors';
import { leaveFor } from '@/app/lib/leave-for';
import { useT } from '@/lib/i18n/client';

import { ProviderMark } from './provider-mark';

export interface AddAccountTarget {
  /** Re-authenticating an existing account rather than adding a new one. */
  account: AccountView | null;
}

interface AddAccountDialogProps {
  open: boolean;
  target: AddAccountTarget;
  /** The providers the gateway offers, in the order it offers them. */
  providers: ProviderId[];
  onOpenChange: (open: boolean) => void;
  onConnected: (account: AccountView) => void;
}

/** The fastest this panel asks after a device code, whatever the vendor says. */
const MIN_POLL_MS = 2000;

/**
 * Pick the subscription, then approve it at the vendor. How the grant comes
 * back depends on what the vendor allows from where the gateway runs, and the
 * gateway picks it:
 *
 * - a device code (ChatGPT): the person enters a one-time code on the
 *   vendor's page, and the gateway finishes the moment it is approved — this
 *   dialog only waits, and closes on its own;
 * - a redirect (Claude, when the gateway is reached on a loopback address):
 *   the page goes to the vendor and comes straight back to the gateway, whose
 *   panel then says how it went;
 * - a paste (Claude anywhere else, or ChatGPT's browser fallback): the
 *   vendor's page shows a code, or lands on an address that will not load,
 *   and the person carries that back by hand.
 *
 * Re-authenticating skips the choice: the provider is already known and the
 * new tokens land on the existing row.
 */
export function AddAccountDialog({
  open,
  target,
  providers,
  onOpenChange,
  onConnected,
}: AddAccountDialogProps) {
  const { t } = useT('addAccount');
  const { t: tProviders } = useT('providers');
  const { toast } = useToast();

  const [chosenProvider, setChosenProvider] = useState<ProviderId | null>(null);
  const [label, setLabel] = useState('');
  const [start, setStart] = useState<AuthorizationStart | null>(null);
  const [pasted, setPasted] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Re-authenticating is bound to the account's own provider; only a new
  // account gets a choice. Derived rather than copied into state, so opening
  // the dialog on a different row cannot show the previous row's provider.
  const provider = target.account?.provider ?? chosenProvider ?? providers[0];

  /**
   * Closing always discards the attempt. A half-finished authorization must
   * not carry its state, its pasted value or its error into the next one —
   * and doing it here, in the event that causes it, keeps the reset out of
   * an effect that would fire a second render on every open. Closing also
   * ends the wait on a device code: the effect that polls for it stops.
   */
  function changeOpen(next: boolean) {
    if (!next) {
      setChosenProvider(null);
      setLabel('');
      setStart(null);
      setPasted('');
      setError(null);
      setBusy(false);
    }
    onOpenChange(next);
  }

  function describe(cause: unknown): string {
    return t(
      authorizationErrorKey(cause instanceof ApiError ? cause.code : 'failed'),
    );
  }

  function finished(account: AccountView) {
    onConnected(account);
    toast({
      title: t('connected', { label: account.label }),
      variant: 'success',
    });
    changeOpen(false);
  }

  async function beginAuthorization(method?: 'browser') {
    if (!provider) return;
    setBusy(true);
    setError(null);
    try {
      const next = await gatewayApi.authorize({
        provider,
        accountId: target.account?.id ?? null,
        label: label.trim() || null,
        method,
      });
      if (next.flow === 'redirect') {
        // Straight to the vendor and back: the gateway finishes the sign-in
        // on its own `/callback`, and the panel it lands on says how it went.
        leaveFor(next.authorizeUrl);
        return;
      }
      setPasted('');
      setStart(next);
    } catch (cause) {
      setError(describe(cause));
    } finally {
      setBusy(false);
    }
  }

  async function connect() {
    if (!start) return;
    setBusy(true);
    setError(null);
    try {
      finished(await gatewayApi.complete({ state: start.state, pasted }));
    } catch (cause) {
      setError(describe(cause));
    } finally {
      setBusy(false);
    }
  }

  // The callbacks the device wait reports into, read fresh on every report
  // without restarting the wait each time the dialog re-renders.
  const onDeviceConnected = useEffectEvent((account: AccountView) => {
    finished(account);
  });
  const onDeviceFailed = useEffectEvent((code: string) => {
    setError(t(authorizationErrorKey(code)));
  });

  const deviceState = start?.flow === 'device' ? start.state : null;
  const pollMs =
    start?.flow === 'device'
      ? Math.max(MIN_POLL_MS, start.pollIntervalSeconds * 1000)
      : 0;
  const waiting = deviceState !== null && error === null;

  /**
   * Wait on a device code: ask the gateway where it stands at the pace the
   * vendor set — the gateway asks the vendor, and finishes the sign-in the
   * moment it is approved — and ask at once when the person returns to this
   * tab, the likeliest moment the code was just approved in another.
   */
  useEffect(() => {
    if (!deviceState || !waiting) return undefined;
    let stopped = false;
    let running = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const check = async () => {
      if (stopped || running) return;
      running = true;
      clearTimeout(timer);
      try {
        const status = await gatewayApi.authorizationStatus(deviceState);
        if (stopped) return;
        if (status.status === 'connected') {
          onDeviceConnected(status.account);
          return;
        }
        if (status.status === 'failed') {
          onDeviceFailed(status.code);
          return;
        }
      } catch (cause) {
        // A panel that lost the gateway for a moment keeps waiting; the
        // sign-in itself is the vendor's and has not gone anywhere.
        console.warn('[ai-gateway] asking after the sign-in failed:', cause);
      } finally {
        running = false;
      }
      if (!stopped) timer = setTimeout(() => void check(), pollMs);
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    timer = setTimeout(() => void check(), pollMs);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [deviceState, pollMs, waiting]);

  const title = target.account
    ? t('reauthenticateTitle', { label: target.account.label })
    : t('title');

  return (
    <Dialog
      footer={
        <div className="flex justify-end gap-2">
          <Button
            onClick={() => changeOpen(false)}
            type="button"
            variant="secondary"
          >
            {t('cancel')}
          </Button>
          {start?.flow === 'paste' ? (
            <Button
              disabled={busy || pasted.trim().length === 0}
              onClick={() => void connect()}
              type="button"
            >
              {t('connect')}
            </Button>
          ) : start?.flow === 'device' ? (
            error ? (
              <Button
                disabled={busy}
                onClick={() => void beginAuthorization()}
                type="button"
              >
                {t('startAgain')}
              </Button>
            ) : null
          ) : (
            <Button
              disabled={busy || !provider}
              onClick={() => void beginAuthorization()}
              type="button"
            >
              {t('continue')}
            </Button>
          )}
        </div>
      }
      onOpenChange={changeOpen}
      open={open}
      title={title}
    >
      <div className="flex flex-col gap-5">
        {start?.flow === 'device' ? (
          <>
            <section className="flex flex-col gap-2">
              <Text variant="label">{t('approveHeading')}</Text>
              <Text variant="muted">{t('deviceDescription')}</Text>
              <ExternalLink href={start.verificationUrl}>
                {t('deviceOpen')}
              </ExternalLink>
            </section>
            <CopyableField
              label={t('deviceCodeLabel')}
              mono
              value={start.userCode}
            />
            {/* One live line: it announces the wait once, and the error
                that ends it, without re-reading the steps above. */}
            <div aria-live="polite" className="min-h-5" role="status">
              {error ? (
                <Text variant="error">{error}</Text>
              ) : (
                <span className="text-muted-foreground flex items-center gap-2 text-sm">
                  {/* Decorative: the words beside it say what is going on,
                      and a second status inside this one would say it twice. */}
                  <LoaderCircle
                    aria-hidden
                    className="size-4 shrink-0 animate-spin motion-reduce:animate-none"
                  />
                  {t('deviceWaiting')}
                </span>
              )}
            </div>
            <Button
              className="self-start"
              disabled={busy}
              onClick={() => void beginAuthorization('browser')}
              type="button"
              variant="link"
            >
              {t('deviceBrowser')}
            </Button>
          </>
        ) : start?.flow === 'paste' ? (
          <>
            <section className="flex flex-col gap-2">
              <Text variant="label">{t('approveHeading')}</Text>
              <Text variant="muted">{t('approveDescription')}</Text>
              <ExternalLink href={start.authorizeUrl}>
                {t('openLink')}
              </ExternalLink>
              <CopyableField
                label={t('urlLabel')}
                mono
                value={start.authorizeUrl}
              />
            </section>
            <section className="flex flex-col gap-2">
              <Text variant="label">{t('resultHeading')}</Text>
              <Textarea
                autoFocus
                errorMessage={error ?? undefined}
                description={
                  start.pasteStyle === 'code'
                    ? t('resultHintCode')
                    : t('resultHintRedirectUrl')
                }
                label={t('resultLabel')}
                onChange={(event) => setPasted(event.target.value)}
                rows={3}
                value={pasted}
                wideControl
              />
            </section>
          </>
        ) : (
          <>
            <Select
              disabled={target.account !== null}
              label={t('providerLabel')}
              onValueChange={(value) => {
                if (isProviderId(value)) setChosenProvider(value);
              }}
              // The vendor's mark beside its name, in the list and in the
              // closed control alike — the same marks the table rows lead
              // with, so the choice reads the way the pool does.
              options={providers.map((id) => ({
                value: id,
                label: tProviders(id),
                icon: <ProviderMark className="size-4" provider={id} />,
              }))}
              value={provider ?? ''}
            />
            <Input
              description={t('nameDescription')}
              label={t('nameLabel')}
              onChange={(event) => setLabel(event.target.value)}
              placeholder={t('namePlaceholder')}
              value={label}
              wideControl
            />
            {error ? <Text variant="error">{error}</Text> : null}
          </>
        )}
      </div>
    </Dialog>
  );
}
