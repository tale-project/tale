import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { forgetSavedLocale, saveLocale } from '@/tests/utils/lapsed-session';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@/tests/utils/render';

import { UpsertMatterDialog } from './upsert-matter-dialog';

const upsert = vi.hoisted(() => vi.fn());

vi.mock('../hooks/mutations', () => ({
  useUpsertLegalMatter: () => ({ mutateAsync: upsert, isPending: false }),
}));
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-a',
}));
vi.mock('@tale/ui/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  upsert.mockResolvedValue('matter-a');
});

afterEach(async () => {
  cleanup();
  await forgetSavedLocale();
});

describe('UpsertMatterDialog API-compatible descriptions', () => {
  it.each([2500, 4000])(
    'saves a name-only edit without truncating a retained %i-character description',
    async (length) => {
      const description = 'a'.repeat(length);
      const onOpenChange = vi.fn();
      const { user } = render(
        <UpsertMatterDialog
          open
          onOpenChange={onOpenChange}
          organizationId="org-a"
          matter={{ _id: 'matter-a', name: 'Original', description }}
        />,
      );
      fireEvent.change(screen.getByRole('textbox', { name: /Name/ }), {
        target: { value: 'Renamed' },
      });
      const save = screen.getByRole('button', { name: 'Save' });
      await waitFor(() => expect(save).toBeEnabled());
      await user.click(save);
      await waitFor(() =>
        expect(upsert).toHaveBeenCalledWith({
          organizationId: 'org-a',
          matterId: 'matter-a',
          name: 'Renamed',
          caseNumber: undefined,
          description,
        }),
      );
      expect(onOpenChange).toHaveBeenCalledWith(false);
    },
  );

  it('creates a matter with trimmed fields at all API limits', async () => {
    const { user } = render(
      <UpsertMatterDialog open onOpenChange={vi.fn()} organizationId="org-a" />,
    );
    const values = {
      name: 'n'.repeat(300),
      caseNumber: 'c'.repeat(200),
      description: 'd'.repeat(4000),
    };
    for (const [label, value] of [
      [/Name/, values.name],
      [/Case number/, values.caseNumber],
      [/Description/, values.description],
    ] as const) {
      const field = screen.getByRole('textbox', { name: label });
      fireEvent.change(field, { target: { value: ` ${value} ` } });
      fireEvent.blur(field);
    }
    const create = screen.getByRole('button', { name: 'Create matter' });
    await waitFor(() => expect(create).toBeEnabled());
    await user.click(create);
    await waitFor(() =>
      expect(upsert).toHaveBeenCalledWith({
        organizationId: 'org-a',
        matterId: undefined,
        ...values,
      }),
    );
  });
});

describe.each([
  {
    locale: 'en',
    labels: ['Name', 'Case number', 'Description'],
    message: (field: string, max: number) =>
      `${field} must be ${max} characters or fewer`,
    save: 'Save',
  },
  {
    locale: 'de',
    labels: ['Name', 'Aktenzeichen', 'Beschreibung'],
    message: (field: string, max: number) =>
      `${field} darf höchstens ${max} Zeichen lang sein`,
    save: 'Speichern',
  },
  {
    locale: 'fr',
    labels: ['Nom', "Numéro d'affaire", 'Description'],
    message: (field: string, max: number) =>
      `${field} ne doit pas dépasser ${max} caractères`,
    save: 'Enregistrer',
  },
] as const)('UpsertMatterDialog field refusals ($locale)', (copy) => {
  it.each([
    { index: 0, max: 300 },
    { index: 1, max: 200 },
    { index: 2, max: 4000 },
  ])(
    'identifies field $index above its $max-character limit',
    async ({ index, max }) => {
      saveLocale(copy.locale);
      render(
        <UpsertMatterDialog
          open
          onOpenChange={vi.fn()}
          organizationId="org-a"
          matter={{ _id: 'matter-a', name: 'Original' }}
        />,
      );
      const label = copy.labels[index];
      const field = screen.getByRole('textbox', { name: label });
      fireEvent.change(field, { target: { value: 'a'.repeat(max + 1) } });
      fireEvent.blur(field);

      const error = await screen.findByText(copy.message(label, max));
      expect(error).toHaveAttribute('role', 'alert');
      expect(field).toHaveAttribute('aria-invalid', 'true');
      expect(field.getAttribute('aria-describedby')?.split(' ')).toContain(
        error.id,
      );
      const save = screen.getByRole('button', { name: copy.save });
      expect(save).toBeDisabled();
      expect(upsert).not.toHaveBeenCalled();
      if (index === 2) await checkAccessibility(document.body);

      fireEvent.change(field, { target: { value: 'a'.repeat(max) } });
      await waitFor(() => {
        expect(
          screen.queryByText(copy.message(label, max)),
        ).not.toBeInTheDocument();
        expect(field).not.toHaveAttribute('aria-invalid', 'true');
        expect(save).toBeEnabled();
      });
    },
  );
});
