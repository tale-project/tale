// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { type ContextType } from 'react';
import { describe, it, expect, vi } from 'vitest';

import {
  DirtySourceContext,
  type DirtySourceOptions,
} from './use-dirty-source';
import { useRegisterDirtySource } from './use-dirty-source';

function Source({
  dirty,
  options,
}: {
  dirty: boolean;
  options?: DirtySourceOptions;
}) {
  useRegisterDirtySource(dirty, options);
  return null;
}

// The registry is passed IN as a prop (not constructed inside the component
// that renders the provider), so it stays a single stable reference across
// rerenders — and satisfies jsx-no-constructed-context-values without a
// per-render `useMemo`.
function Harness({
  registry,
  dirty,
  options,
}: {
  registry: ContextType<typeof DirtySourceContext>;
  dirty: boolean;
  options?: DirtySourceOptions;
}) {
  return (
    <DirtySourceContext.Provider value={registry}>
      <Source dirty={dirty} options={options} />
    </DirtySourceContext.Provider>
  );
}

describe('useRegisterDirtySource', () => {
  it('registers dirty state and unregisters (not just sets false) on unmount', () => {
    const register = vi.fn();
    const unregister = vi.fn();
    const registry = { register, unregister };

    const { rerender, unmount } = render(
      <Harness registry={registry} dirty={false} />,
    );

    // Initial register with its stable id.
    expect(register).toHaveBeenCalledTimes(1);
    const [id] = register.mock.calls[0];
    expect(register).toHaveBeenCalledWith(id, { dirty: false });

    rerender(<Harness registry={registry} dirty />);
    expect(register).toHaveBeenCalledWith(id, { dirty: true });

    unmount();
    // Unmount must DELETE the entry (unregister), not leave a stale `false`
    // in the registry map — otherwise the map grows unbounded across a session.
    expect(unregister).toHaveBeenCalledWith(id);
    expect(register).not.toHaveBeenLastCalledWith(id, { dirty: false });
  });

  it('registers scopePath and a save wrapper that reaches the latest closure', async () => {
    const register = vi.fn();
    const registry = { register, unregister: vi.fn() };
    const firstSave = vi.fn().mockResolvedValue(undefined);
    const secondSave = vi.fn().mockResolvedValue(undefined);

    const { rerender } = render(
      <Harness
        registry={registry}
        dirty
        options={{ scopePath: '/dashboard/org/agents/a', save: firstSave }}
      />,
    );
    const [id, entry] = register.mock.calls.at(-1) ?? [];
    expect(entry).toMatchObject({
      dirty: true,
      scopePath: '/dashboard/org/agents/a',
    });
    expect(typeof entry.save).toBe('function');

    // A re-render swapping only the save callback must not re-register, yet
    // the ALREADY-registered wrapper must call the NEW closure — the provider
    // invokes it at dialog-click time, potentially renders later.
    rerender(
      <Harness
        registry={registry}
        dirty
        options={{ scopePath: '/dashboard/org/agents/a', save: secondSave }}
      />,
    );
    await entry.save();
    expect(firstSave).not.toHaveBeenCalled();
    expect(secondSave).toHaveBeenCalledTimes(1);
    expect(register.mock.calls.at(-1)?.[0]).toBe(id);
  });

  it('registers no save when the caller omits one (invalid draft)', () => {
    const register = vi.fn();
    const registry = { register, unregister: vi.fn() };
    render(<Harness registry={registry} dirty options={{ scopePath: '/x' }} />);
    const [, entry] = register.mock.calls.at(-1) ?? [];
    expect(entry.save).toBeUndefined();
  });

  it('no-ops without a provider (does not throw)', () => {
    expect(() => render(<Source dirty />)).not.toThrow();
  });
});
