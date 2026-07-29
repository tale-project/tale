// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { RefreshCw } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, within } from '@/tests/utils/render';

import {
  noExtras,
  type CredentialAdapter,
  type CredentialLike,
  type CredentialVendor,
} from './adapter';
import { CredentialRow } from './credential-row';

const toast = vi.fn();
vi.mock('@/app/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));
// FormDialog reads the org from the router; there is no router here.
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

interface Vendor extends CredentialVendor {
  kind: string;
}
interface Cred extends CredentialLike {
  masked?: string;
}

const vendor: Vendor = {
  key: 'github',
  displayName: 'GitHub',
  needsEndpoint: false,
  kind: 'connector',
};

const mutate = {
  create: vi.fn().mockResolvedValue({}),
  update: vi.fn().mockResolvedValue(null),
  remove: vi.fn().mockResolvedValue(null),
  setDefault: vi.fn().mockResolvedValue(null),
};

const adapter: CredentialAdapter<
  Vendor,
  Cred,
  'api-key' | 'oauth2',
  string,
  undefined
> = {
  ns: 'connectors',
  logTag: 'test',
  mapError: (err) => String(err),
  methodLabel: (_t, method) => (method === 'oauth2' ? 'OAuth' : 'API key'),
  methodOf: (cred) =>
    cred.authMethod === 'oauth2'
      ? 'oauth2'
      : cred.authMethod === 'api-key'
        ? 'api-key'
        : null,
  formMethods: () => ['api-key'],
  statusLabel: (_t, status) =>
    status === 'disabled'
      ? 'Disabled'
      : status === 'needs-reauth'
        ? 'Reconnect needed'
        : null,
  statusTone: (status) => (status === 'needs-reauth' ? 'orange' : 'slate'),
  facts: (cred) => [cred.masked, cred.endpointUrl],
  detailLine: (_t, cred) =>
    cred.status === 'needs-reauth'
      ? 'Re-run consent to restore access.'
      : undefined,
  extraActions: ({ credential, busy }) => [
    {
      key: 'reconnect',
      label: 'Reconnect',
      icon: RefreshCw,
      onClick: vi.fn(),
      visible: credential.authMethod === 'oauth2',
      disabled: busy,
    },
  ],
  endpointField: () => ({ label: 'Endpoint' }),
  secret: {
    empty: () => '',
    isDirty: (d) => d.length > 0,
    isComplete: (method, d) => method === 'oauth2' || d.length > 0,
    buildArgs: (_t, _m, d) => ({ ok: true, args: { token: d } }),
    hasFields: (method) => method !== 'oauth2',
    replaceTitle: (_t, method) =>
      method === 'oauth2' ? null : 'Replace API key',
    Fields: () => null,
  },
  extra: noExtras<Vendor, Cred>(),
  vendorArg: (v) => ({ connectorSlug: v.key }),
  mutations: {
    useCreate: () => ({ mutateAsync: mutate.create, isPending: false }),
    useUpdate: () => ({ mutateAsync: mutate.update, isPending: false }),
    useDelete: () => ({ mutateAsync: mutate.remove, isPending: false }),
    useSetDefault: () => ({ mutateAsync: mutate.setDefault, isPending: false }),
  },
};

function renderRow(over: Partial<Cred> = {}) {
  const credential: Cred = {
    id: 'cred_1',
    name: 'Support bot',
    authMethod: 'api-key',
    status: 'active',
    isDefault: false,
    masked: 'ghp_…4f2a',
    ...over,
  };
  return {
    credential,
    ...render(
      <ul>
        <CredentialRow
          organizationId="org-1"
          credential={credential}
          vendor={vendor}
          adapter={adapter}
        />
      </ul>,
    ),
  };
}

const menu = async (user: ReturnType<typeof renderRow>['user']) => {
  await user.click(
    screen.getByRole('button', { name: 'Actions for Support bot' }),
  );
  return within(await screen.findByRole('menu'));
};

describe('CredentialRow', () => {
  it('shows the name, method and masked coordinates — never a secret', () => {
    renderRow();
    expect(screen.getByText('Support bot')).toBeInTheDocument();
    expect(screen.getByText('API key')).toBeInTheDocument();
    expect(screen.getByText('ghp_…4f2a')).toBeInTheDocument();
  });

  it('marks the default credential', () => {
    renderRow({ isDefault: true });
    expect(screen.getByText('Default')).toBeInTheDocument();
  });

  it('keeps a disabled credential neutral and a stale grant attention-worthy', () => {
    const disabled = renderRow({ status: 'disabled' });
    expect(screen.getByText('Disabled')).toBeInTheDocument();
    expect(
      screen.queryByText('Re-run consent to restore access.'),
    ).not.toBeInTheDocument();
    disabled.unmount();

    renderRow({ status: 'needs-reauth', authMethod: 'oauth2' });
    expect(screen.getByText('Reconnect needed')).toBeInTheDocument();
    // The state that a human must act on says what to do.
    expect(
      screen.getByText('Re-run consent to restore access.'),
    ).toBeInTheDocument();
  });

  it('offers make-default inertly for a disabled credential rather than hiding it', async () => {
    const { user } = renderRow({ status: 'disabled' });
    const item = (await menu(user)).getByRole('menuitem', {
      name: 'Make default',
    });
    expect(item).toHaveAttribute('aria-disabled', 'true');
  });

  it('hides make-default on the credential that already is the default', async () => {
    const { user } = renderRow({ isDefault: true });
    expect(
      (await menu(user)).queryByRole('menuitem', { name: 'Make default' }),
    ).not.toBeInTheDocument();
  });

  it('offers replace-secret only where a hand-entered secret exists', async () => {
    const withSecret = renderRow();
    expect(
      (await menu(withSecret.user)).getByRole('menuitem', {
        name: 'Replace API key',
      }),
    ).toBeInTheDocument();
    withSecret.unmount();

    const oauth = renderRow({ authMethod: 'oauth2' });
    const m = await menu(oauth.user);
    // An OAuth grant has nothing to replace, but it can be reconnected.
    expect(
      m.queryByRole('menuitem', { name: 'Replace API key' }),
    ).not.toBeInTheDocument();
    expect(m.getByRole('menuitem', { name: 'Reconnect' })).toBeInTheDocument();
  });

  it('toggles status through the update mutation', async () => {
    const { user } = renderRow({ status: 'disabled' });
    await user.click(
      (await menu(user)).getByRole('menuitem', { name: 'Enable' }),
    );
    expect(mutate.update).toHaveBeenCalledWith({
      organizationId: 'org-1',
      credentialId: 'cred_1',
      status: 'active',
    });
  });

  it('deletes only after an explicit confirm, warning when it is the default', async () => {
    const { user } = renderRow({ isDefault: true });
    await user.click(
      (await menu(user)).getByRole('menuitem', { name: 'Delete' }),
    );
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByText(/leaves no default/i)).toBeInTheDocument();
    expect(mutate.remove).not.toHaveBeenCalled();
    await user.click(dialog.getByRole('button', { name: /delete/i }));
    expect(mutate.remove).toHaveBeenCalledWith({
      organizationId: 'org-1',
      credentialId: 'cred_1',
    });
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = renderRow({
        status: 'needs-reauth',
        authMethod: 'oauth2',
      });
      await checkAccessibility(container);
    });
  });
});
