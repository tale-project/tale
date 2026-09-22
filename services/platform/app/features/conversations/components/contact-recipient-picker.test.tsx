// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { ContactRecipientPicker } from './contact-recipient-picker';

interface Row {
  _id: string;
  name?: string;
  email?: string;
}

/** What the mocked reads answer, per test. */
const state: {
  rows: Row[];
  searched: Row[] | null;
  selected: Row | null;
  isLoading: boolean;
  canWrite: boolean;
  duplicateHit: Row[];
} = {
  rows: [],
  searched: null,
  selected: null,
  isLoading: false,
  canWrite: true,
  duplicateHit: [],
};

const useContacts = vi.fn((_orgId: string, search?: string) => ({
  contacts: search && state.searched ? state.searched : state.rows,
  isLoading: state.isLoading,
}));

vi.mock('@/app/features/contacts/hooks/queries', () => ({
  useContacts: (orgId: string, search?: string) => useContacts(orgId, search),
  useContact: () => state.selected,
}));

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({
    can: () => state.canWrite,
    cannot: () => !state.canWrite,
  }),
}));

// The debounce itself is covered in `@tale/ui`; collapsing it here keeps these
// assertions about the picker rather than about timers.
vi.mock('@tale/ui/use-debounce', () => ({
  useDebounce: (value: string) => value,
}));

const toast = vi.fn();
vi.mock('@tale/ui/use-toast', () => ({
  toast: (args: unknown) => toast(args),
}));

const ensureAdaptedQueryData = vi.fn(async () => state.duplicateHit);
vi.mock('@/app/lib/backend/prefetch', () => ({
  ensureAdaptedQueryData: () => ensureAdaptedQueryData(),
}));

vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useQueryClient: () => ({ invalidateQueries: vi.fn(async () => undefined) }),
}));

/** Stands in for the real form: exposes the seeded address and the two
 *  callbacks the picker wires, so a test can drive them directly. */
vi.mock('@/app/features/contacts/components/contact-create-dialog', () => ({
  ContactCreateDialog: ({
    initialEmail,
    onCreated,
    onDuplicateEmail,
  }: {
    initialEmail?: string;
    onCreated?: (id: string) => void;
    onDuplicateEmail?: (email: string) => Promise<string | null>;
  }) => (
    <div>
      <span data-testid="seeded-email">{initialEmail}</span>
      <button type="button" onClick={() => onCreated?.('contact-new')}>
        Stub save
      </button>
      <button
        type="button"
        onClick={() => {
          void onDuplicateEmail?.(initialEmail ?? '').then((id) => {
            if (id !== null && id !== undefined) onCreated?.(id);
          });
        }}
      >
        Stub duplicate
      </button>
    </div>
  ),
}));

function renderPicker(overrides: { value?: string | null } = {}) {
  const onChange = vi.fn();
  const result = render(
    <ContactRecipientPicker
      organizationId="org-1"
      value={overrides.value ?? null}
      onChange={onChange}
    />,
  );
  return { ...result, onChange };
}

const ADD_ROW = /Add "jane@example.com" as a contact/i;

async function openAndType(
  user: ReturnType<typeof render>['user'],
  text: string,
) {
  await user.click(screen.getByRole('button', { name: /^To/ }));
  if (text !== '') await user.type(screen.getByRole('combobox'), text);
}

beforeEach(() => {
  state.rows = [
    { _id: 'contact-1', name: 'Ada Lovelace', email: 'ada@example.com' },
  ];
  state.searched = null;
  state.selected = null;
  state.isLoading = false;
  state.canWrite = true;
  state.duplicateHit = [];
  useContacts.mockClear();
  toast.mockClear();
  ensureAdaptedQueryData.mockClear();
});

describe('ContactRecipientPicker', () => {
  it('narrows the contact list server-side with what was typed', async () => {
    const { user } = renderPicker();
    await openAndType(user, 'jane');
    expect(useContacts).toHaveBeenCalledWith('org-1', 'jane');
  });

  it('offers to add an address that matches no contact', async () => {
    state.searched = [];
    const { user } = renderPicker();
    await openAndType(user, 'jane@example.com');
    expect(screen.getByRole('option', { name: ADD_ROW })).toBeInTheDocument();
  });

  it('withholds the offer for text that is not an address', async () => {
    state.searched = [];
    const { user } = renderPicker();
    await openAndType(user, 'jane');
    expect(screen.queryByRole('option', { name: /as a contact/i })).toBeNull();
    expect(
      screen.getByText(/Type a full email address to add a new contact/i),
    ).toBeInTheDocument();
  });

  it('withholds the offer for an address a contact already carries, whatever the casing', async () => {
    state.searched = [
      { _id: 'contact-9', name: 'Jane Doe', email: 'Jane@Example.com' },
    ];
    const { user } = renderPicker();
    await openAndType(user, 'jane@example.com');
    expect(screen.queryByRole('option', { name: /as a contact/i })).toBeNull();
  });

  // The placeholder a contact carries when its address could not be resolved:
  // offering to create it would only earn a duplicate refusal.
  it('withholds the offer for the unknown-address placeholder', async () => {
    state.searched = [];
    const { user } = renderPicker();
    await openAndType(user, 'unknown@example.com');
    expect(screen.queryByRole('option', { name: /as a contact/i })).toBeNull();
  });

  it('withholds the offer from someone who may not write contacts', async () => {
    state.searched = [];
    state.canWrite = false;
    const { user } = renderPicker();
    await openAndType(user, 'jane@example.com');
    expect(screen.queryByRole('option', { name: ADD_ROW })).toBeNull();
  });

  it('withholds the offer while the search is still in flight', async () => {
    state.searched = [];
    state.isLoading = true;
    const { user } = renderPicker();
    await openAndType(user, 'jane@example.com');
    expect(screen.queryByRole('option', { name: ADD_ROW })).toBeNull();
  });

  it('seeds the create form with the typed address and takes the new contact as the recipient', async () => {
    state.searched = [];
    const { user, onChange } = renderPicker();
    await openAndType(user, 'jane@example.com');
    await user.click(screen.getByRole('option', { name: ADD_ROW }));
    expect(screen.getByTestId('seeded-email')).toHaveTextContent(
      'jane@example.com',
    );
    await user.click(screen.getByRole('button', { name: 'Stub save' }));
    expect(onChange).toHaveBeenCalledWith('contact-new');
  });

  it('keeps naming the selected contact when the search excludes it', async () => {
    state.selected = {
      _id: 'contact-42',
      name: 'Grace Hopper',
      email: 'grace@example.com',
    };
    state.searched = [
      { _id: 'contact-7', name: 'Jane Doe', email: 'jane@example.com' },
    ];
    const { user } = renderPicker({ value: 'contact-42' });
    await openAndType(user, 'jane');
    // The trigger's accessible name is the field label, so the contact it is
    // naming is its text — which falls back to the placeholder if the pin goes.
    expect(screen.getByRole('button', { name: /^To/ })).toHaveTextContent(
      'Grace Hopper',
    );
  });

  it('recovers from a duplicate by selecting the contact that already exists', async () => {
    state.searched = [];
    state.duplicateHit = [
      { _id: 'contact-existing', email: 'jane@example.com' },
    ];
    const { user, onChange } = renderPicker();
    await openAndType(user, 'jane@example.com');
    await user.click(screen.getByRole('option', { name: ADD_ROW }));
    await user.click(screen.getByRole('button', { name: 'Stub duplicate' }));
    expect(onChange).toHaveBeenCalledWith('contact-existing');
    expect(toast).toHaveBeenCalled();
  });

  it('leaves a duplicate it cannot resolve to the dialog', async () => {
    state.searched = [];
    state.duplicateHit = [];
    const { user, onChange } = renderPicker();
    await openAndType(user, 'jane@example.com');
    await user.click(screen.getByRole('option', { name: ADD_ROW }));
    await user.click(screen.getByRole('button', { name: 'Stub duplicate' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it('has no accessibility violations with the offer on screen', async () => {
    state.searched = [];
    const { user, container } = renderPicker();
    await openAndType(user, 'jane@example.com');
    await checkAccessibility(container);
  });
});
