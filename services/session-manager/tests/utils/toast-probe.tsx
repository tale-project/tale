import { useToast } from '@tale/ui/use-toast';
import { screen } from '@testing-library/react';

import { openToasts } from './toasts';

/**
 * Puts the toasts that are open on the page, as text a test can read: the
 * Toaster is the app's, so a component test renders this beside the component.
 */
export function ToastProbe() {
  const { toasts } = useToast();
  return (
    <div data-testid="toast-probe">
      {openToasts(toasts)
        .map(
          (toast) =>
            `${toast.variant ?? 'default'}: ${typeof toast.title === 'string' ? toast.title : ''}`,
        )
        .join('\n')}
    </div>
  );
}

/** The open toasts, as `variant: title` lines. */
export function openToastLines(): string[] {
  const text = screen.getByTestId('toast-probe').textContent ?? '';
  return text === '' ? [] : text.split('\n');
}
