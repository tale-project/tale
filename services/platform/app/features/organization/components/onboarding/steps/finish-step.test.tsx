import { describe, expect, it, vi } from 'vitest';

import { Wizard } from '@/app/components/ui/wizard/wizard';
import { render, screen } from '@/tests/utils/render';

import { FinishStep } from './finish-step';

const fmt = (current: number, total: number, label: string) =>
  `Step ${current} of ${total}: ${label}`;

function renderFinish(
  onFinishTo?: (t: 'providers' | 'agents' | 'members') => void,
  providerConnected?: boolean,
) {
  return render(
    <Wizard
      steps={[{ id: 'finish', label: 'Finish' }]}
      onFinish={() => {}}
      formatProgress={fmt}
    >
      <FinishStep
        onFinishTo={onFinishTo}
        providerConnected={providerConnected}
      />
    </Wizard>,
  );
}

describe('FinishStep CTAs', () => {
  it('each CTA marks-and-routes via onFinishTo with its target', async () => {
    const onFinishTo = vi.fn();
    const { user } = renderFinish(onFinishTo);

    await user.click(
      screen.getByRole('button', { name: 'Connect a provider' }),
    );
    expect(onFinishTo).toHaveBeenCalledWith('providers');

    await user.click(screen.getByRole('button', { name: 'Invite teammates' }));
    expect(onFinishTo).toHaveBeenCalledWith('members');
  });

  it('disables the CTAs when no handler is provided', () => {
    renderFinish(undefined);
    expect(
      screen.getByRole('button', { name: 'Connect a provider' }),
    ).toBeDisabled();
  });

  it('renders the provider row as done (no CTA) when one is connected', () => {
    renderFinish(vi.fn(), true);
    // The pending "Connect a provider" CTA is replaced by a done marker...
    expect(
      screen.queryByRole('button', { name: 'Connect a provider' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('AI provider connected.')).toBeInTheDocument();
    // ...while the other next-step CTAs still render.
    expect(
      screen.getByRole('button', { name: 'Invite teammates' }),
    ).toBeInTheDocument();
  });
});
