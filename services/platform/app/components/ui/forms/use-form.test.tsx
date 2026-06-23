// @vitest-environment jsdom
import { zodResolver } from '@hookform/resolvers/zod';
import { act, renderHook } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { z } from 'zod';

import { useForm } from './use-form';

interface Form {
  name: string;
}

const schema = z.object({ name: z.string().min(1) });

describe('useForm (shared wrapper)', () => {
  it("defaults the validation mode to 'onTouched' (#1943)", () => {
    const { result } = renderHook(() => useForm<Form>());
    // `_options.mode` is RHF's record of the resolved mode; the wrapper sets it.
    // oxlint-disable-next-line typescript/no-explicit-any -- reading RHF internals for the assertion
    expect((result.current.control as any)._options.mode).toBe('onTouched');
  });

  it('lets a caller override the default mode explicitly', () => {
    const { result } = renderHook(() => useForm<Form>({ mode: 'onChange' }));
    // oxlint-disable-next-line typescript/no-explicit-any -- reading RHF internals for the assertion
    expect((result.current.control as any)._options.mode).toBe('onChange');
  });

  it('does not flag a field as errored on the first keystroke before blur', async () => {
    const { result } = renderHook(() =>
      useForm<Form>({
        defaultValues: { name: '' },
        resolver: zodResolver(schema),
      }),
    );

    // Register the field, then change it without ever blurring — exactly the
    // "typing the first character" path from #1943. Under `onTouched` no error
    // is set until the field is blurred. (The blur -> error path is covered by
    // the form integration tests, e.g. team-create-dialog / enterprise-sso.)
    act(() => {
      result.current.register('name');
    });
    await act(async () => {
      result.current.setValue('name', 'a');
    });
    expect(result.current.formState.errors.name).toBeUndefined();

    // Even reverting to the invalid empty value (still untouched) stays clean.
    await act(async () => {
      result.current.setValue('name', '');
    });
    expect(result.current.formState.errors.name).toBeUndefined();
  });
});
