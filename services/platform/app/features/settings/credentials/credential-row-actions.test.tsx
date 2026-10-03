import { toast } from '@tale/ui/use-toast';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { connectorCredentialAdapter } from '@/app/features/settings/connectors/credential-adapter';
import { useConnectorCredentials } from '@/app/features/settings/connectors/hooks/queries';
import { providerCredentialAdapter } from '@/app/features/settings/providers/credential-adapter';
import { useProviderCredentials } from '@/app/features/settings/providers/hooks/queries';
import { render, screen, waitFor, within } from '@/tests/utils/render';

import { CredentialRowActions } from './credential-row-actions';

vi.mock('@tale/ui/use-toast', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tale/ui/use-toast')>();
  const mockToast = vi.fn();
  return {
    ...actual,
    toast: mockToast,
    useToast: () => ({ toast: mockToast }),
  };
});

const ORG = 'org-credentials';
const credential = {
  id: 'credential-1',
  name: 'Synthetic credential',
  authMethod: 'api-key' as const,
  status: 'active' as const,
  isDefault: false,
  createdAt: 1,
  updatedAt: 1,
};
const connectorCredential = { ...credential, connectorSlug: 'tavily' };
const providerCredential = {
  ...credential,
  providerSlug: 'openai',
  hash: 'synthetic-hash',
};

function ConnectorActions() {
  return (
    <CredentialRowActions
      organizationId={ORG}
      credential={connectorCredential}
      vendor={null}
      siblingCount={0}
      adapter={connectorCredentialAdapter}
    />
  );
}

function ProviderActions() {
  return (
    <CredentialRowActions
      organizationId={ORG}
      credential={providerCredential}
      vendor={null}
      siblingCount={0}
      adapter={providerCredentialAdapter}
    />
  );
}

function ConnectorList() {
  const credentials = useConnectorCredentials(ORG);
  return credentials.data?.map((row) => (
    <div key={row.id}>
      <span>{row.name}</span>
      <ConnectorActions />
    </div>
  ));
}

function ProviderList() {
  const credentials = useProviderCredentials(ORG);
  return credentials.data?.map((row) => (
    <div key={row.id}>
      <span>{row.name}</span>
      <ProviderActions />
    </div>
  ));
}

let queryClient: QueryClient;
let writeAnswer: { status: number; body: unknown };
let deleted: boolean;
let deletePaths: string[];

function json(body: unknown, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  writeAnswer = { status: 204, body: null };
  deleted = false;
  deletePaths = [];
  window.__ENV__ = { BASE_PATH: '' };
  vi.spyOn(window, 'fetch').mockImplementation(async (input, init) => {
    const path = new URL(
      input instanceof Request ? input.url : String(input),
      'http://localhost',
    ).pathname;
    if (init?.method === 'DELETE') {
      deletePaths.push(path);
      deleted = true;
      return json(writeAnswer.body, writeAnswer.status);
    }
    if (path === '/api/app/connector-credentials') {
      return json({ credentials: deleted ? [] : [connectorCredential] });
    }
    if (path === '/api/app/provider-credentials') {
      return json({ credentials: deleted ? [] : [providerCredential] });
    }
    if (path.endsWith('/dependents')) return json({ usedBy: [] });
    return json({ error: 'UNAUTHORIZED' }, 401);
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  queryClient.clear();
  vi.mocked(toast).mockClear();
  vi.restoreAllMocks();
  delete window.__ENV__;
});

describe.each([
  {
    surface: 'Connectors',
    Actions: ConnectorActions,
    List: ConnectorList,
    deletePath: '/api/app/connector-credentials/credential-1',
  },
  {
    surface: 'AI providers',
    Actions: ProviderActions,
    List: ProviderList,
    deletePath: '/api/app/provider-credentials/credential-1',
  },
])('CredentialRowActions on $surface', ({ Actions, List, deletePath }) => {
  async function confirmDelete(showList = false) {
    const { user } = render(
      <QueryClientProvider client={queryClient}>
        {showList ? <List /> : <Actions />}
      </QueryClientProvider>,
    );
    await user.click(
      await screen.findByRole('button', {
        name: 'Actions for Synthetic credential',
      }),
    );
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Delete credential',
    });
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(deletePaths).toEqual([deletePath]));
  }

  it('quietly closes confirmation for CREDENTIAL_NOT_FOUND', async () => {
    writeAnswer = {
      status: 404,
      body: { error: 'CREDENTIAL_NOT_FOUND', message: 'Credential not found.' },
    };

    await confirmDelete();

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(toast).not.toHaveBeenCalled();
  });

  it('refetches and drops the vanished row without a destructive toast', async () => {
    writeAnswer = {
      status: 404,
      body: { error: 'CREDENTIAL_NOT_FOUND', message: 'Credential not found.' },
    };

    await confirmDelete(true);

    await waitFor(() =>
      expect(
        screen.queryByText('Synthetic credential'),
      ).not.toBeInTheDocument(),
    );
    expect(toast).not.toHaveBeenCalled();
  });

  it('keeps a genuine refusal destructive and shows its reason', async () => {
    writeAnswer = {
      status: 403,
      body: {
        error: 'ROLE_FORBIDDEN',
        message: 'Only admins can delete credentials.',
      },
    };

    await confirmDelete();

    await waitFor(() =>
      expect(toast).toHaveBeenCalledExactlyOnceWith({
        title:
          'Could not delete the credential: Only admins can delete credentials.',
        variant: 'destructive',
      }),
    );
    expect(
      screen.getByRole('dialog', { name: 'Delete credential' }),
    ).toBeInTheDocument();
  });

  it('keeps the success feedback for an existing credential', async () => {
    await confirmDelete(true);

    await waitFor(() =>
      expect(toast).toHaveBeenCalledExactlyOnceWith({
        title: 'Credential deleted',
      }),
    );
    await waitFor(() =>
      expect(
        screen.queryByText('Synthetic credential'),
      ).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
