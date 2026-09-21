import { Button } from '@tale/ui/button';
import { Card } from '@tale/ui/card';
import { FullPageCenter } from '@tale/ui/full-page-center';
import { Heading } from '@tale/ui/heading';
import { Input } from '@tale/ui/input';
import { Text } from '@tale/ui/text';
import { useState, type FormEvent } from 'react';

import { ApiError } from '@/app/lib/api';
import { useT } from '@/lib/i18n/client';

/**
 * The panel's door. One password, no user list — so the form is one field and
 * the only failures worth naming are "wrong password" and "no answer".
 */
export function SignInScreen({
  onSignIn,
}: {
  onSignIn: (password: string) => Promise<void>;
}) {
  const { t } = useT('signIn');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await onSignIn(password);
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'invalid_password') {
        setError(t('wrongPassword'));
      } else if (cause instanceof ApiError && cause.code === 'unreachable') {
        setError(t('unreachable'));
      } else {
        setError(t('failed'));
      }
      setSubmitting(false);
    }
  }

  return (
    <FullPageCenter>
      <Card className="w-full max-w-sm" padding="xl">
        <form className="flex flex-col gap-5" onSubmit={submit}>
          <div className="flex flex-col gap-1">
            <Heading level={1} size="lg">
              {t('heading')}
            </Heading>
            <Text variant="muted">{t('description')}</Text>
          </div>
          <Input
            autoComplete="current-password"
            autoFocus
            errorMessage={error ?? undefined}
            isInvalid={error !== null}
            label={t('passwordLabel')}
            name="password"
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
            wideControl
          />
          <Button
            className="w-full"
            disabled={submitting || password.length === 0}
            type="submit"
          >
            {t('submit')}
          </Button>
        </form>
      </Card>
    </FullPageCenter>
  );
}
