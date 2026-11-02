import type * as UseToast from '@tale/ui/use-toast';

type Raised = Parameters<typeof UseToast.toast>[0];

/**
 * Every toast raised so far. The toast store holds one at a time, so it cannot
 * tell one failure from two in a row (the second replaces the first). This can,
 * which is what "one failure, one toast" needs. A test file uses it by mocking
 * the module with `recordToasts`, and clears `raised` before each test.
 */
export const raised: Raised[] = [];

export function recordToasts(actual: typeof UseToast): typeof UseToast {
  const toast: typeof UseToast.toast = (props) => {
    raised.push(props);
    return actual.toast(props);
  };
  return {
    ...actual,
    toast,
    useToast: () => ({ ...actual.useToast(), toast }),
  };
}

/** The failures a person was told about. */
export function failureToasts(): Raised[] {
  return raised.filter((toast) => toast.variant === 'destructive');
}
