// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { type ContextType } from 'react';
import { describe, it, expect, vi } from 'vitest';

import { DirtySourceContext } from './use-dirty-source';
import { useRegisterDirtySource } from './use-dirty-source';

function Source({ dirty }: { dirty: boolean }) {
  useRegisterDirtySource(dirty);
  return null;
}

// The registry is passed IN as a prop (not constructed inside the component
// that renders the provider), so it stays a single stable reference across
// rerenders — and satisfies jsx-no-constructed-context-values without a
// per-render `useMemo`.
function Harness({
  registry,
  dirty,
}: {
  registry: ContextType<typeof DirtySourceContext>;
  dirty: boolean;
}) {
  return (
    <DirtySourceContext.Provider value={registry}>
      <Source dirty={dirty} />
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
    expect(register).toHaveBeenCalledWith(id, false);

    rerender(<Harness registry={registry} dirty />);
    expect(register).toHaveBeenCalledWith(id, true);

    unmount();
    // Unmount must DELETE the entry (unregister), not leave a stale `false`
    // in the registry map — otherwise the map grows unbounded across a session.
    expect(unregister).toHaveBeenCalledWith(id);
    expect(register).not.toHaveBeenLastCalledWith(id, false);
  });

  it('no-ops without a provider (does not throw)', () => {
    expect(() => render(<Source dirty />)).not.toThrow();
  });
});
