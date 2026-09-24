import { Button } from '@tale/ui/button';
import { CopyableField } from '@tale/ui/copyable-field';
import { Dialog } from '@tale/ui/dialog/dialog';
import { ExternalLink } from '@tale/ui/external-link';
import { Input } from '@tale/ui/input';
import { Select } from '@tale/ui/select';
import { Text } from '@tale/ui/text';
import { Textarea } from '@tale/ui/textarea';
import { useToast } from '@tale/ui/use-toast';
import { useState } from 'react';

import {
  ApiError,
  gatewayApi,
  isProviderId,
  type AccountView,
  type AuthorizationStart,
  type ProviderId,
} from '@/app/lib/api';
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

/**
 * Two steps, because an OAuth consent happens in a browser this panel does
 * not control: pick the subscription, then carry the result back by hand.
 * What "the result" looks like differs per provider — Anthropic's console
 * prints a code, OpenAI redirects to a loopback address that may not load —
 * so the second step asks for whichever one the provider named.
 *
 * Re-authenticating skips the first step: the provider is already known and
 * the new tokens land on the existing row.
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
   * an effect that would fire a second render on every open.
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

  function describe(cause: unknown, fallback: string): string {
    if (cause instanceof ApiError) {
      const known = [
        'unknown_state',
        'missing_code',
        'state_mismatch',
        'exchange_failed',
      ];
      if (known.includes(cause.code)) return t(`errors.${cause.code}`);
    }
    return fallback;
  }

  async function beginAuthorization() {
    if (!provider) return;
    setBusy(true);
    setError(null);
    try {
      setStart(
        await gatewayApi.authorize({
          provider,
          accountId: target.account?.id ?? null,
        }),
      );
    } catch (cause) {
      setError(describe(cause, t('errors.failed')));
    } finally {
      setBusy(false);
    }
  }

  async function connect() {
    if (!start) return;
    setBusy(true);
    setError(null);
    try {
      const account = await gatewayApi.complete({
        state: start.state,
        pasted,
        label: label.trim() || null,
      });
      onConnected(account);
      toast({ description: t('connected', { label: account.label }) });
      changeOpen(false);
    } catch (cause) {
      setError(describe(cause, t('errors.failed')));
    } finally {
      setBusy(false);
    }
  }

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
          {start ? (
            <Button
              disabled={busy || pasted.trim().length === 0}
              onClick={() => void connect()}
              type="button"
            >
              {t('connect')}
            </Button>
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
        {start ? (
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
                  start.callbackStyle === 'code'
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
