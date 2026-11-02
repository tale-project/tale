import { useToast } from '@tale/ui/use-toast';

import { openToasts } from '@/tests/utils/toasts';

/**
 * The notices a person can still read, as a list that a test can look at: each
 * is its title, then its description after a colon.
 */
export function Notices() {
  const { toasts } = useToast();
  return (
    <ul aria-label="Notices">
      {openToasts(toasts).map((toast) => (
        <li key={toast.id}>
          {typeof toast.title === 'string' ? toast.title : ''}
          {typeof toast.description === 'string'
            ? `: ${toast.description}`
            : ''}
        </li>
      ))}
    </ul>
  );
}
