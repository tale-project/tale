import { useForm } from '@tale/ui/use-form';
import { act } from 'react';
import { describe, expect, it } from 'vitest';

import { renderHook } from '@/tests/utils/render';

import { useConnectionTestResult } from './use-connection-test-result';

function renderResultHook() {
  const rendered = renderHook(
    ({ organizationId }) => {
      const form = useForm({
        defaultValues: { host: 'original.example.test' },
      });
      return { form, ...useConnectionTestResult(form, organizationId) };
    },
    { initialProps: { organizationId: 'org-synthetic' } },
  );
  return {
    ...rendered,
    beginTest: () => {
      let publish: ReturnType<
        typeof rendered.result.current.beginTest
      > = () => {};
      act(() => {
        publish = rendered.result.current.beginTest();
      });
      return publish;
    },
  };
}

describe('useConnectionTestResult', () => {
  it('only publishes the latest test even when older tests finish last', () => {
    const { result, beginTest } = renderResultHook();
    const publishOld = beginTest();
    const publishNew = beginTest();
    act(() => publishNew({ ok: true, message: 'New result' }));
    act(() => publishOld({ ok: false, message: 'Old refusal' }));
    expect(result.current.testResult).toEqual({
      ok: true,
      message: 'New result',
    });
  });

  it('invalidates pending tests when the form resets', () => {
    const { result, beginTest } = renderResultHook();
    const publish = beginTest();
    act(() => result.current.form.reset());
    act(() => publish({ ok: true }));
    expect(result.current.testResult).toBeUndefined();
  });

  it('invalidates pending tests when the organization changes', () => {
    const { result, rerender, beginTest } = renderResultHook();
    const publish = beginTest();
    rerender({ organizationId: 'org-other-synthetic' });
    act(() => publish({ ok: true }));
    expect(result.current.testResult).toBeUndefined();
  });

  it('allows a fresh test after an edited draft invalidates the old one', () => {
    const { result, beginTest } = renderResultHook();
    const publishOld = beginTest();
    act(() => result.current.form.setValue('host', 'edited.example.test'));
    const publishNew = beginTest();
    act(() => publishOld({ ok: true, message: 'Old result' }));
    expect(result.current.testResult).toBeUndefined();
    act(() => publishNew({ ok: true, message: 'Edited result' }));
    expect(result.current.testResult?.message).toBe('Edited result');
  });
});
