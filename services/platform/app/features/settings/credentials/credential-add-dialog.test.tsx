import { AppShell } from '@tale/ui/app-shell';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  connectorCredentialAdapter,
  toConnectorVendor,
  type ConnectorVendor,
} from '@/app/features/settings/connectors/credential-adapter';
import type {
  ConnectorSummary,
  MaskedConnectorCredential,
} from '@/app/features/settings/connectors/hooks/backend';
import { i18n } from '@/lib/i18n/i18n';

import { type CredentialConsentProps } from './adapter';
import { CredentialAddDialog } from './credential-add-dialog';

/**
 * #3674 at the seam the settings pages use: the shared add wizard, the
 * connectors adapter, the real create hook and its HTTP adapter row. Only
 * `fetch` is stubbed, and it holds the create until the test answers it the
 * way the server refuses a duplicate name.
 *
 * Cancel was disabled while the save was in flight, but the header's Back
 * still cleared the draft: the late refusal then landed on a fresh, empty form
 * and the name, login and servers the reader had typed were gone.
 */

vi.mock('@tale/ui/use-toast', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tale/ui/use-toast')>();
  return { ...actual, toast: vi.fn() };
});

const ORG = 'org-connectors';
const TAKEN = 'Office mailbox';
// What `assertNameFree` answers for a clash (connector_credentials/service.ts).
const NAME_TAKEN = `A credential named "${TAKEN}" already exists for this connector — pick a different name.`;

const imapSmtp: ConnectorSummary = {
  slug: 'imap-smtp',
  displayName: 'IMAP / SMTP Mailbox',
  description: 'Connect a private IMAP + SMTP mail server to Conversations.',
  tags: ['Email'],
  endpointMode: 'fixed',
  authMethods: ['basic'],
  configFields: [
    { key: 'imapHost', label: 'IMAP server', type: 'string', required: true },
    { key: 'smtpHost', label: 'SMTP server', type: 'string', required: true },
  ],
  actionCount: 2,
};

const existing = {
  id: 'cred-1',
  connectorSlug: 'imap-smtp',
  name: TAKEN,
  authMethod: 'basic',
  isDefault: true,
  status: 'active',
  createdAt: 1,
  updatedAt: 1,
} as unknown as MaskedConnectorCredential;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** The create requests sent so far, each held until the test answers it. */
let held: Array<(response: Response) => void> = [];
let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return (
    <AppShell i18n={i18n} locale={{ mode: 'client' }}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </AppShell>
  );
}

function renderWizard({
  adapter = connectorCredentialAdapter,
  onOpenChange = vi.fn(),
}: {
  adapter?: typeof connectorCredentialAdapter;
  onOpenChange?: (open: boolean) => void;
} = {}) {
  const user = userEvent.setup();
  render(
    <CredentialAddDialog
      organizationId={ORG}
      vendors={[toConnectorVendor(imapSmtp)]}
      credentials={[existing]}
      adapter={adapter}
      open
      onOpenChange={onOpenChange}
      searchPlaceholder="Search connectors"
      catalogEmpty="No connectors"
      catalogLoading={false}
    />,
    { wrapper },
  );
  return { user, dialog: within(screen.getByRole('dialog')) };
}

type Wizard = ReturnType<typeof renderWizard>;

const field = {
  name: (dialog: Wizard['dialog']) =>
    dialog.getByRole('textbox', { name: /^Name/ }),
  username: (dialog: Wizard['dialog']) =>
    dialog.getByLabelText(/^Username/, { selector: 'input' }),
  password: (dialog: Wizard['dialog']) =>
    dialog.getByLabelText(/^Password/, { selector: 'input' }),
  imapHost: (dialog: Wizard['dialog']) =>
    dialog.getByRole('textbox', { name: /^IMAP server/ }),
  smtpHost: (dialog: Wizard['dialog']) =>
    dialog.getByRole('textbox', { name: /^SMTP server/ }),
};

/** Pick the mailbox connector and fill its form under a name already taken. */
async function fillDuplicate({ user, dialog }: Wizard) {
  // Pasted, not typed key by key: each keystroke re-renders the whole wizard,
  // and five typed fields outlast the default test timeout under a busy jsdom.
  const fill = async (input: HTMLElement, value: string) => {
    await user.clear(input);
    await user.paste(value);
  };
  await user.click(dialog.getByRole('button', { name: /IMAP \/ SMTP/ }));
  await fill(field.name(dialog), TAKEN);
  await fill(field.username(dialog), 'hello@example.com');
  await fill(field.password(dialog), 'mailbox-secret');
  await fill(field.imapHost(dialog), 'imap.example.com');
  await fill(field.smtpHost(dialog), 'smtp.example.com');
}

/** Everything the reader typed is still in the form. */
function expectDraftKept(dialog: Wizard['dialog']) {
  expect(field.name(dialog)).toHaveValue(TAKEN);
  expect(field.username(dialog)).toHaveValue('hello@example.com');
  expect(field.password(dialog)).toHaveValue('mailbox-secret');
  expect(field.imapHost(dialog)).toHaveValue('imap.example.com');
  expect(field.smtpHost(dialog)).toHaveValue('smtp.example.com');
}

/** Answer the held create the way the server refuses a duplicate name. */
async function refuseAsDuplicate() {
  const answer = held.shift();
  expect(answer).toBeDefined();
  await act(async () => {
    answer?.(
      json({ error: 'CREDENTIAL_NAME_TAKEN', message: NAME_TAKEN }, 409),
    );
  });
}

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  held = [];
  window.__ENV__ = { BASE_PATH: '' };
  vi.spyOn(window, 'fetch').mockImplementation((_input, init) => {
    if ((init?.method ?? 'GET') === 'GET') {
      // Nothing in the wizard reads; the session probe gets a plain no.
      return Promise.resolve(json({ error: 'UNAUTHORIZED' }, 401));
    }
    return new Promise<Response>((resolve) => {
      held.push(resolve);
    });
  });
  // The dialog and the hook each log the refusal; the Alert is what's tested.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  queryClient.clear();
  vi.restoreAllMocks();
  delete window.__ENV__;
});

/**
 * A consent pane with ways out of its own, which the adapter contract hands
 * it, beside the form of a vendor that takes either a grant or a typed login.
 */
function ConsentWithExits({
  onBack,
  onClose,
}: CredentialConsentProps<ConnectorVendor>) {
  return (
    <div>
      <button type="button" onClick={onBack}>
        Consent back
      </button>
      <button type="button" onClick={onClose}>
        Consent close
      </button>
    </div>
  );
}

// Each test drives the whole wizard through a held request; on a loaded
// runner that needs more than the default five seconds.
describe(
  'CredentialAddDialog while a create is in flight (#3674)',
  { timeout: 30_000 },
  () => {
    it('keeps Back as closed as Cancel, so the refusal returns to the form that sent it', async () => {
      const wizard = renderWizard();
      const { user, dialog } = wizard;
      await fillDuplicate(wizard);

      await user.click(dialog.getByRole('button', { name: 'Add credential' }));
      await waitFor(() => expect(held).toHaveLength(1));

      const back = dialog.getByRole('button', { name: 'Back' });
      expect(dialog.getByRole('button', { name: 'Cancel' })).toBeDisabled();
      expect(back).toBeDisabled();

      // A click on the dead control changes nothing: no picker, same draft.
      await user.click(back);
      expect(
        dialog.queryByRole('button', { name: /IMAP \/ SMTP/ }),
      ).not.toBeInTheDocument();
      expectDraftKept(dialog);

      await refuseAsDuplicate();

      expect(await dialog.findByText(NAME_TAKEN)).toBeInTheDocument();
      expectDraftKept(dialog);
      // Settled: the reader can correct the name, or step back on purpose.
      expect(field.name(dialog)).toBeEnabled();
      expect(back).toBeEnabled();
    });

    it('keeps the draft through a refusal without Back, and an idle Back still starts over', async () => {
      const wizard = renderWizard();
      const { user, dialog } = wizard;
      await fillDuplicate(wizard);

      await user.click(dialog.getByRole('button', { name: 'Add credential' }));
      await waitFor(() => expect(held).toHaveLength(1));
      await refuseAsDuplicate();

      expect(await dialog.findByText(NAME_TAKEN)).toBeInTheDocument();
      expectDraftKept(dialog);

      // Nothing is in flight now, so Back is the deliberate reset it always was.
      await user.click(dialog.getByRole('button', { name: 'Back' }));
      await user.click(dialog.getByRole('button', { name: /IMAP \/ SMTP/ }));

      expect(field.name(dialog)).toHaveValue('IMAP / SMTP Mailbox');
      expect(field.username(dialog)).toHaveValue('');
      expect(field.password(dialog)).toHaveValue('');
      expect(field.imapHost(dialog)).toHaveValue('');
      expect(field.smtpHost(dialog)).toHaveValue('');
      expect(dialog.queryByText(NAME_TAKEN)).not.toBeInTheDocument();
    });

    it("holds the consent pane's exits to the same wait", async () => {
      const onOpenChange = vi.fn();
      const wizard = renderWizard({
        adapter: {
          ...connectorCredentialAdapter,
          offersConsent: () => true,
          Consent: ConsentWithExits,
        },
        onOpenChange,
      });
      const { user, dialog } = wizard;
      await fillDuplicate(wizard);

      await user.click(dialog.getByRole('button', { name: 'Add credential' }));
      await waitFor(() => expect(held).toHaveLength(1));

      // Its back stays on the form: no picker, the same draft.
      await user.click(dialog.getByRole('button', { name: 'Consent back' }));
      expect(
        dialog.queryByRole('button', { name: /IMAP \/ SMTP/ }),
      ).not.toBeInTheDocument();
      expectDraftKept(dialog);

      // Its close neither closes the dialog nor clears it.
      await user.click(dialog.getByRole('button', { name: 'Consent close' }));
      expect(onOpenChange).not.toHaveBeenCalled();
      expectDraftKept(dialog);

      await refuseAsDuplicate();

      expect(await dialog.findByText(NAME_TAKEN)).toBeInTheDocument();
      expectDraftKept(dialog);
    });
  },
);
