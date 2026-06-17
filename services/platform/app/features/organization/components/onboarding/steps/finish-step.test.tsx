import { describe, expect, it, vi } from 'vitest';

import { Wizard } from '@/app/components/ui/wizard/wizard';
import { render, screen } from '@/tests/utils/render';

import { FinishStep } from './finish-step';

const fmt = (current: number, total: number, label: string) =>
  `Step ${current} of ${total}: ${label}`;

function renderFinish(
  onFinishTo?: (t: 'providers' | 'agents' | 'members') => void,
) {
  return render(
    <Wizard
      steps={[{ id: 'finish', label: 'Finish' }]}
      onFinish={() => {}}
      formatProgress={fmt}
    >
      <FinishStep onFinishTo={onFinishTo} />
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

    await user.click(screen.getByRole('button', { name: 'Create an agent' }));
    expect(onFinishTo).toHaveBeenCalledWith('agents');

    await user.click(screen.getByRole('button', { name: 'Invite teammates' }));
    expect(onFinishTo).toHaveBeenCalledWith('members');
  });

  it('disables the CTAs when no handler is provided', () => {
    renderFinish(undefined);
    expect(
      screen.getByRole('button', { name: 'Connect a provider' }),
    ).toBeDisabled();
  });
});
