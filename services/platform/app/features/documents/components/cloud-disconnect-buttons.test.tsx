import { toast } from '@tale/ui/use-toast';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';
import {
  SESSION_ENDED,
  SHIPPED_LOCALES,
  forgetSavedLocale,
  lapsedSessionRefusal,
  saveLocale,
} from '@/tests/utils/lapsed-session';
import { render, screen, waitFor } from '@/tests/utils/render';

const { revoke } = vi.hoisted(() => ({ revoke: vi.fn() }));

vi.mock('@/app/hooks/use-backend-mutation', () => ({
  useBackendMutation: () => ({ mutateAsync: revoke }),
}));
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));
vi.mock('@tale/ui/use-toast', () => ({ toast: vi.fn() }));

import { GoogleDisconnectButton } from './google-disconnect-button';
import { MicrosoftDisconnectButton } from './microsoft-disconnect-button';

const BUTTONS = [
  ['Google Drive', GoogleDisconnectButton, 'googledrive'],
  ['Microsoft 365', MicrosoftDisconnectButton, 'onedrive'],
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

// The refusal's own `message` is its serialized payload; the toast used to
// read `{"code":"UNAUTHORIZED",…}` under its localized title.
describe.each(SHIPPED_LOCALES)(
  'the cloud disconnect buttons after a lapsed session (%s)',
  (locale) => {
    beforeEach(() => {
      saveLocale(locale);
    });
    afterEach(forgetSavedLocale);

    it.each(BUTTONS)(
      'says the session ended when disconnecting %s is refused',
      async (_name, Button, ns) => {
        revoke.mockImplementation(() => lapsedSessionRefusal());
        const { user } = render(<Button />);
        await waitFor(() => expect(i18n.language).toBe(locale));
        const t = i18n.getFixedT(locale, 'documents');

        await user.click(
          screen.getByRole('button', { name: t(`${ns}.disconnect`) }),
        );

        await waitFor(() =>
          expect(vi.mocked(toast)).toHaveBeenCalledWith({
            title: t(`${ns}.disconnectFailed`),
            description: SESSION_ENDED[locale],
            variant: 'destructive',
          }),
        );
      },
    );
  },
);
