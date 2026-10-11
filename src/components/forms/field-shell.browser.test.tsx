import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { render } from '@/tests/utils/render';

import { FIELD_LAYOUT_ROW, FieldShell } from './field-shell';

import '@tale/ui/globals.css';

afterEach(() => {
  cleanup();
});

const LONG_DESCRIPTION =
  'The display name for your organization, shown on invitations, in the sidebar and on every shared link.';

function renderRowSurface(width: number) {
  return render(
    <div {...FIELD_LAYOUT_ROW} style={{ width }}>
      <FieldShell
        label={<span>Organization name</span>}
        description={<span>{LONG_DESCRIPTION}</span>}
      >
        <input aria-label="Organization name" className="w-full" />
      </FieldShell>
    </div>,
  );
}

function frameOf(): HTMLElement {
  const input = screen.getByRole('textbox', { name: 'Organization name' });
  // input → control column → frame
  const frame = input.parentElement?.parentElement;
  if (!frame) throw new Error('no field frame');
  return frame;
}

// jsdom has no layout and no container queries — what decides a row is the
// width of the surface the field sits in, which only a real engine measures.
// The viewport is the same (wide) in every case: a settings column squeezed
// beside the rail and the settings panel must stack even on a desktop window.
describe('FieldShell row layout (real layout)', () => {
  it('stacks while its row-layout surface is narrower than 36rem', () => {
    renderRowSurface(480);
    const frame = frameOf();
    expect(getComputedStyle(frame).flexDirection).toBe('column');
    // Stacked, the control takes the surface's full width.
    const input = screen.getByRole('textbox', { name: 'Organization name' });
    expect(input.getBoundingClientRect().width).toBeCloseTo(480, 0);
  });

  it('lays the label left and the 20rem control right once the surface has room', () => {
    renderRowSurface(640);
    const frame = frameOf();
    expect(getComputedStyle(frame).flexDirection).toBe('row');
    const input = screen.getByRole('textbox', { name: 'Organization name' });
    expect(input.getBoundingClientRect().width).toBeCloseTo(320, 0);
  });

  it('wraps a long label column instead of pushing the row past its surface', () => {
    // 36rem exactly: the smallest row. The label column (max 20rem) yields
    // width to the fixed control rather than overflowing the frame.
    renderRowSurface(576);
    const frame = frameOf();
    expect(getComputedStyle(frame).flexDirection).toBe('row');
    expect(frame.scrollWidth).toBeLessThanOrEqual(frame.clientWidth);
    const input = screen.getByRole('textbox', { name: 'Organization name' });
    expect(input.getBoundingClientRect().right).toBeLessThanOrEqual(
      frame.getBoundingClientRect().right + 0.5,
    );
  });

  it('stacks outside any row-layout surface, however wide', () => {
    render(
      <div style={{ width: 900 }}>
        <FieldShell label={<span>Organization name</span>}>
          <input aria-label="Organization name" className="w-full" />
        </FieldShell>
      </div>,
    );
    expect(getComputedStyle(frameOf()).flexDirection).toBe('column');
  });
});
