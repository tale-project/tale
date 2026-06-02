import { describe, it, expect, vi } from 'vitest';

import { useFormEditor } from '@/app/components/ui/editor';
import { fireEvent, render, waitFor } from '@/test/utils/render';

import { OrganizationSettingsView } from './organization-settings';

interface Form {
  name: string;
  defaultLocale: string;
}

const save = vi.fn(async (_v: Form) => {});

const holder: { current: ReturnType<typeof useFormEditor<Form>> | null } = {
  current: null,
};

function Harness() {
  const editor = useFormEditor<Form>({
    data: { name: 'Acme', defaultLocale: 'en' },
    save,
  });
  holder.current = editor;
  return (
    <OrganizationSettingsView
      controller={editor}
      organization={{ _id: 'org1', name: 'Acme' }}
      onSave={save}
    />
  );
}

describe('OrganizationSettingsView locale select', () => {
  it('does not mark the form dirty on a spurious empty change', async () => {
    render(<Harness />);
    // Baseline applied → not dirty.
    await waitFor(() => expect(holder.current?.isLoading).toBe(false));
    expect(holder.current?.isDirty).toBe(false);

    // Radix renders a hidden native <select> for form integration; a spurious
    // empty value propagates through it as `onValueChange('')` during the
    // cold-load window. Simulate that — the guard must drop it.
    const native = document.querySelector('select');
    expect(native).not.toBeNull();
    fireEvent.change(native as HTMLSelectElement, { target: { value: '' } });

    expect(holder.current?.isDirty).toBe(false);
    expect(holder.current?.form.getValues('defaultLocale')).toBe('en');
  });

  it('marks the form dirty when a real locale is selected', async () => {
    render(<Harness />);
    await waitFor(() => expect(holder.current?.isLoading).toBe(false));

    const native = document.querySelector('select');
    fireEvent.change(native as HTMLSelectElement, { target: { value: 'de' } });

    await waitFor(() => expect(holder.current?.isDirty).toBe(true));
    expect(holder.current?.form.getValues('defaultLocale')).toBe('de');
  });
});
