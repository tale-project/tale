// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { PdfLinkPopup } from './pdf-link-popup';

vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({
    t: (key: string) =>
      ({
        'preview.link.copy': 'Copy link',
        'preview.link.copied': 'Copied',
        'preview.link.visit': 'Visit link',
      })[key] ?? key,
  }),
}));

// Render the popup the way the app does: inside a Radix Dialog (the document
// preview surface). This is the context where button clicks were being stolen.
function renderInDialog(onClose: () => void) {
  return render(
    <DialogPrimitive.Root open>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content aria-describedby={undefined}>
          <DialogPrimitive.Title>Preview</DialogPrimitive.Title>
          <PdfLinkPopup
            state={{ url: 'https://example.com', x: 100, y: 100 }}
            onClose={onClose}
          />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>,
  );
}

describe('PdfLinkPopup inside a dialog', () => {
  let writeText: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
  });

  it('copies the link when the Copy button is clicked (does not close first)', () => {
    const onClose = vi.fn();
    renderInDialog(onClose);

    const copyBtn = screen.getByRole('button', { name: /copy link/i });
    fireEvent.pointerDown(copyBtn);
    fireEvent.click(copyBtn);

    expect(writeText).toHaveBeenCalledWith('https://example.com');
  });

  it('does not dismiss when interacting inside the popup', () => {
    const onClose = vi.fn();
    renderInDialog(onClose);

    const visitBtn = screen.getByRole('button', { name: /visit link/i });
    // A pointerdown inside the popup must not trigger the outside-click close.
    fireEvent.pointerDown(visitBtn);
    expect(onClose).not.toHaveBeenCalled();
  });
});
