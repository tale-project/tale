import { useToast } from '@tale/ui/use-toast';
import { screen, within } from '@testing-library/react';

import { openToasts } from './toasts';

/**
 * The toasts a person would see, as a list a test can read: render it beside
 * the component under test, then ask `shownToasts()` what it holds. One item
 * per toast is how a test says "one failure, one toast".
 */
export function ToastList() {
  const { toasts } = useToast();
  return (
    <ul aria-label="Toasts">
      {openToasts(toasts).map((toast) => (
        <li key={toast.id}>
          <span>{toast.title}</span>
          <span>{toast.description}</span>
        </li>
      ))}
    </ul>
  );
}

export interface ShownToast {
  title: string;
  description: string;
}

/**
 * What `ToastList` holds now. Read through an open dialog too, which hides the
 * rest of the page from the accessibility tree.
 */
export function shownToasts(): ShownToast[] {
  const list = screen.getByRole('list', { name: 'Toasts', hidden: true });
  return within(list)
    .queryAllByRole('listitem', { hidden: true })
    .map((item) => ({
      title: item.children[0]?.textContent ?? '',
      description: item.children[1]?.textContent ?? '',
    }));
}
