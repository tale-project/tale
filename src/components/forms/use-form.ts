'use client';

import {
  useForm as useReactHookForm,
  type FieldValues,
  type UseFormProps,
  type UseFormReturn,
} from 'react-hook-form';

/**
 * App-wide `useForm` wrapper. Defaults the validation `mode` to `'onTouched'`
 * so a field is only validated after its first blur (and re-validated on every
 * change thereafter), instead of erroring on the very first keystroke.
 *
 * Every form in the platform app — settings, dialogs, onboarding, chat — must
 * import `useForm` from here rather than from `react-hook-form` directly, so
 * validation timing stays identical across the app and can't silently regress
 * to `react-hook-form`'s `'onSubmit'` default or an ad-hoc `'onChange'`
 * (see #1943). The `no-restricted-imports` lint rule enforces this.
 *
 * A caller can still override `mode` explicitly when a form genuinely needs
 * different timing — passing `mode` simply wins over the default below.
 */
export function useForm<
  TFieldValues extends FieldValues = FieldValues,
  // oxlint-disable-next-line typescript/no-explicit-any -- mirrors react-hook-form's own `useForm` signature
  TContext = any,
  TTransformedValues = TFieldValues,
>(
  props?: UseFormProps<TFieldValues, TContext, TTransformedValues>,
): UseFormReturn<TFieldValues, TContext, TTransformedValues> {
  return useReactHookForm<TFieldValues, TContext, TTransformedValues>({
    mode: 'onTouched',
    ...props,
  });
}
