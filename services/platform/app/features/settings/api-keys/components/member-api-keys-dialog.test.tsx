import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import {
  act,
  cleanup,
  configure,
  render,
  screen,
  waitFor,
  within,
} from '@/tests/utils/render';
import {
  serviceUnavailable,
  syntheticBackend,
  type SyntheticBackend,
} from '@/tests/utils/synthetic-backend';

import type { MemberPersonalApiKey, MemberPersonalApiKeys } from '../types';
import { MemberApiKeysDialog } from './member-api-keys-dialog';

/**
 * A member's own keys on their row (APIKEY-R11), over the real hooks and
 * `backendFetch` against a closed synthetic transport: each key says whether
 * it works here, an Owner or Admin blocks it here and lifts the block after a
 * confirmation, and an Admin on an Owner's row reads the keys but cannot
 * block them.
 */

// The real retry policy makes four attempts before a failure settles; on a
// loaded runner that outlasts the default one-second wait.
configure({ asyncUtilTimeout: 10_000 });

const toast = vi.fn();
vi.mock('@tale/ui/use-toast', () => ({
  toast: (...args: unknown[]) => toast(...args),
  useToast: () => ({ toast }),
}));

const KEYS_DOOR =
  /^GET \/api\/app\/api-keys\/members\/mia\/personal\?orgId=org-1$/;
const blockDoor = (method: 'PUT' | 'DELETE', keyId: string) =>
  new RegExp(`^${method} /api/app/api-keys/${keyId}/block\\?orgId=org-1$`);

function personalKey(
  overrides: Partial<MemberPersonalApiKey> = {},
): MemberPersonalApiKey {
  return {
    id: 'key-1',
    name: 'Deploy bot',
    start: 'tale_abc',
    prefix: 'tale_',
    suffix: 'wxyz',
    enabled: true,
    expiresAt: null,
    createdAt: Date.UTC(2026, 9, 1),
    blocked: null,
    ...overrides,
  };
}

const BLOCK = {
  at: Date.UTC(2026, 9, 20),
  by: { userId: 'ada', name: 'Ada' },
};

let backend: SyntheticBackend;
let client: QueryClient;
/** What the keys door answers; a block or a lift changes it. */
let answer: MemberPersonalApiKeys;

beforeEach(() => {
  window.history.replaceState({}, '', '/dashboard/org-1/settings/members');
  backend = syntheticBackend();
  // No backoff between the policy's attempts; the attempt count is real.
  client = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0, gcTime: Infinity } },
  });
  answer = {
    keys: [
      personalKey(),
      personalKey({ id: 'key-2', name: 'Old laptop', blocked: BLOCK }),
    ],
    canBlock: true,
    personalKeys: 'admitted',
  };
  backend.on(KEYS_DOOR, () => Response.json(answer));
});
afterEach(() => {
  cleanup();
  client.clear();
  toast.mockReset();
  vi.restoreAllMocks();
});

async function renderDialog() {
  const view = render(
    <QueryClientProvider client={client}>
      <MemberApiKeysDialog
        open
        onOpenChange={vi.fn()}
        organizationId="org-1"
        member={{
          userId: 'mia',
          displayName: 'Mia Keller',
          email: 'mia@example.test',
        }}
      />
    </QueryClientProvider>,
  );
  // The app shell settles its language once mounted; let that land in act.
  await act(async () => {});
  return view;
}

async function keyRows() {
  const list = await screen.findByRole('list', {
    name: 'Personal API keys of Mia Keller',
  });
  await waitFor(() =>
    expect(within(list).getByText('Deploy bot')).toBeInTheDocument(),
  );
  return within(list).getAllByRole('listitem');
}

describe('MemberApiKeysDialog', () => {
  it('lists the member’s own keys, each working here or blocked by whom [APIKEY-R11]', async () => {
    await renderDialog();
    const [working, blocked] = await keyRows();

    expect(within(working!).getByText('Works here')).toBeInTheDocument();
    expect(within(working!).getByText('tale_abc … wxyz')).toBeInTheDocument();
    expect(
      within(working!).getByRole('button', { name: 'Block' }),
    ).toBeInTheDocument();
    expect(within(blocked!).getByText('Blocked here')).toBeInTheDocument();
    expect(
      within(blocked!).getByText(/^Blocked by Ada on /),
    ).toBeInTheDocument();
    expect(
      within(blocked!).getByRole('button', { name: 'Lift block' }),
    ).toBeInTheDocument();
    expect(backend.count(KEYS_DOOR)).toBe(1);
  });

  it('blocks a key here only after a confirmation, then shows it blocked [APIKEY-R11]', async () => {
    backend.on(blockDoor('PUT', 'key-1'), () => {
      answer = {
        ...answer,
        keys: answer.keys.map((key) =>
          key.id === 'key-1' ? { ...key, blocked: BLOCK } : key,
        ),
      };
      return Response.json({ changed: true });
    });
    const { user } = await renderDialog();
    const [working] = await keyRows();

    await user.click(within(working!).getByRole('button', { name: 'Block' }));
    const confirm = await screen.findByRole('dialog', {
      name: 'Block this key here?',
    });
    expect(
      within(confirm).getByText(
        'Requests with "Deploy bot" in this organization will be refused. The block does not reach the other organizations Mia Keller belongs to, and Mia Keller is notified.',
      ),
    ).toBeInTheDocument();
    expect(backend.count(blockDoor('PUT', 'key-1'))).toBe(0);

    await user.click(
      within(confirm).getByRole('button', { name: 'Block key' }),
    );
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith({
        title: 'Key blocked in this organization',
        variant: 'success',
      }),
    );
    expect(backend.count(blockDoor('PUT', 'key-1'))).toBe(1);
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Block this key here?' }),
      ).not.toBeInTheDocument(),
    );
    // The answer refreshes the list: both keys now read as blocked here.
    await waitFor(async () => {
      const [first] = await keyRows();
      expect(within(first!).getByText('Blocked here')).toBeInTheDocument();
    });
  });

  it('lifts a block after a confirmation [APIKEY-R11]', async () => {
    backend.on(blockDoor('DELETE', 'key-2'), () =>
      Response.json({ changed: true }),
    );
    const { user } = await renderDialog();
    const [, blocked] = await keyRows();

    await user.click(
      within(blocked!).getByRole('button', { name: 'Lift block' }),
    );
    const confirm = await screen.findByRole('dialog', {
      name: 'Lift the block?',
    });
    await user.click(
      within(confirm).getByRole('button', { name: 'Lift block' }),
    );
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith({
        title: 'Block lifted',
        variant: 'success',
      }),
    );
    expect(backend.count(blockDoor('DELETE', 'key-2'))).toBe(1);
    expect(backend.count(blockDoor('PUT', 'key-2'))).toBe(0);
  });

  it('keeps a key as it was when the block is refused, and says so [APIKEY-R11]', async () => {
    backend.on(blockDoor('PUT', 'key-1'), () =>
      Response.json(
        {
          error: 'An Admin cannot block an Owner’s key.',
          code: 'API_KEY_BLOCK_FORBIDDEN',
        },
        { status: 403 },
      ),
    );
    const { user } = await renderDialog();
    const [working] = await keyRows();

    await user.click(within(working!).getByRole('button', { name: 'Block' }));
    const confirm = await screen.findByRole('dialog', {
      name: 'Block this key here?',
    });
    await user.click(
      within(confirm).getByRole('button', { name: 'Block key' }),
    );
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'The key could not be blocked',
          variant: 'destructive',
        }),
      ),
    );
    // The confirmation stays for another try; cancelling it leaves the key
    // working here.
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    const [still] = await keyRows();
    expect(within(still!).getByText('Works here')).toBeInTheDocument();
    expect(backend.count(blockDoor('PUT', 'key-1'))).toBe(1);
  });

  it('marks no key as working here while this organization refuses members’ own keys, and still lets it block [APIKEY-R11]', async () => {
    answer = { ...answer, personalKeys: 'refused' };
    await renderDialog();
    const [refused, blocked] = await keyRows();

    expect(
      screen.getByText(
        "Members' personal keys are turned off in this organization, so none of these keys works here. A block still applies once they are turned on again.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Works here')).not.toBeInTheDocument();
    expect(within(refused!).getByText('Refused here')).toBeInTheDocument();
    expect(within(blocked!).getByText('Blocked here')).toBeInTheDocument();
    expect(
      within(refused!).getByRole('button', { name: 'Block' }),
    ).toBeEnabled();
    expect(
      within(blocked!).getByRole('button', { name: 'Lift block' }),
    ).toBeEnabled();
  });

  it('claims no key works or is refused while this organization’s setting cannot be read, and still lets it block [APIKEY-R11]', async () => {
    answer = { ...answer, personalKeys: 'unavailable' };
    await renderDialog();
    const [unknown, blocked] = await keyRows();

    expect(
      screen.getByText(
        "The members' personal keys setting can't be read right now, so it isn't known whether these keys work here. Try again shortly.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Works here')).not.toBeInTheDocument();
    expect(screen.queryByText('Refused here')).not.toBeInTheDocument();
    // The block is this organization's own record: it still shows.
    expect(within(blocked!).getByText('Blocked here')).toBeInTheDocument();
    expect(
      within(unknown!).getByRole('button', { name: 'Block' }),
    ).toBeEnabled();
  });

  it('shows no notice while members’ own keys are let in here [APIKEY-R11]', async () => {
    await renderDialog();
    await keyRows();

    expect(
      screen.queryByText(/^Members' personal keys are turned off/),
    ).toBeNull();
    expect(screen.queryByText(/setting can't be read right now/)).toBeNull();
  });

  it('shows an Admin an Owner’s keys without a Block, and says why [APIKEY-R11]', async () => {
    answer = { ...answer, canBlock: false };
    await renderDialog();
    const [working, blocked] = await keyRows();

    expect(within(working!).queryByRole('button')).not.toBeInTheDocument();
    expect(within(blocked!).queryByRole('button')).not.toBeInTheDocument();
    expect(
      screen.getByText("Only an Owner can block an Owner's API keys."),
    ).toBeInTheDocument();
  });

  it('says so when the member has no keys of their own', async () => {
    answer = { keys: [], canBlock: true, personalKeys: 'admitted' };
    await renderDialog();

    expect(
      await screen.findByText('Mia Keller has no personal API keys.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('names a failed read instead of an empty list', async () => {
    backend.on(KEYS_DOOR, () => serviceUnavailable());
    await renderDialog();

    expect(
      await screen.findByText('The keys could not be loaded.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Mia Keller has no personal API keys.'),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Block' })).toBeNull();
  });

  describe('accessibility', () => {
    it('passes axe audit with the keys listed', async () => {
      const { baseElement } = await renderDialog();
      await keyRows();
      await checkAccessibility(baseElement);
    });
  });
});
