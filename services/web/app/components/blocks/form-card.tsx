import { Checkbox } from '@tale/ui/checkbox';
import { cn } from '@tale/ui/cn';
import { FieldShell } from '@tale/ui/field-shell';
import { CheckCircle2 } from 'lucide-react';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import {
  type FieldValues,
  Controller,
  FormProvider,
  type UseFormReturn,
} from 'react-hook-form';

import { PageIllustration } from '@/app/components/blocks/page-illustrations';
import {
  MarketingButton,
  MarketingStack,
  PageSection,
  Reveal,
  SectionHeading,
} from '@/app/components/marketing';
import { MIN_SUBMIT_DELAY_MS, type SubmitRequest } from '@/lib/forms/schemas';
import { submitForm } from '@/lib/forms/submit-client';
import { formSubmitErrorMessage } from '@/lib/forms/submit-errors';
import { useT } from '@/lib/i18n/client';
import { localizedPath } from '@/lib/i18n/locales';
import { useCurrentLocale } from '@/lib/i18n/use-current-locale';

interface BasePayload extends FieldValues {
  privacy: boolean;
  startedAt: number;
  website?: string;
}

interface FormCardProps<T extends BasePayload> {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  formKind: SubmitRequest['form'];
  /** Form instance built by the caller via useForm + zodResolver. */
  form: UseFormReturn<T>;
  /** Render the actual fields. */
  children: ReactNode;
  /** Submit button label. */
  submitLabel: string;
  /** Default values used when resetting after a successful submit. */
  defaultValues: T;
}

type FormError =
  | { kind: 'tooFast' }
  | { kind: 'submit'; status: number; code?: string };

export function FormCard<T extends BasePayload>({
  eyebrow,
  title,
  description,
  formKind,
  form: formExternal,
  children,
  submitLabel,
  defaultValues,
}: FormCardProps<T>) {
  const { t } = useT('forms');
  const locale = useCurrentLocale();
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState<FormError | null>(null);
  const privacyId = useId();
  const privacyLabelId = `${privacyId}-label`;
  const privacyErrorId = `${privacyId}-error`;
  // On success the form (incl. the submit button) unmounts and is replaced by
  // the status block — move focus to its heading so keyboard/AT users aren't
  // stranded on a detached element.
  const successRef = useRef<HTMLHeadingElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const wasSubmittedRef = useRef(false);
  useEffect(() => {
    if (submitted) successRef.current?.focus();
    else if (wasSubmittedRef.current) {
      formRef.current?.querySelector<HTMLElement>('input[required]')?.focus();
    }
    wasSubmittedRef.current = submitted;
  }, [submitted]);

  // Internal type narrowing: T extends BasePayload, so every BasePayload
  // field is present on T at runtime. React-hook-form's `Path<T>` is
  // invariant in T though, so we widen to BasePayload once for the
  // generic-erasing field operations below.
  const form = formExternal as unknown as UseFormReturn<BasePayload>;
  const { setValue } = form;
  useEffect(() => {
    setValue('startedAt', Date.now(), { shouldValidate: false });
  }, [setValue]);

  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null);
    if (Date.now() - values.startedAt < MIN_SUBMIT_DELAY_MS) {
      setServerError({ kind: 'tooFast' });
      return;
    }

    const result = await submitForm({
      form: formKind,
      payload: values,
    } as SubmitRequest);

    if (!result.ok) {
      setServerError({
        kind: 'submit',
        status: result.status,
        code: result.code,
      });
      return;
    }
    setSubmitted(true);
    form.reset(defaultValues);
  });

  return (
    <PageSection pad="xl" border="b" className="relative overflow-hidden">
      <div className="grid min-w-0 gap-10 lg:grid-cols-2 lg:gap-20">
        <Reveal onMount>
          <MarketingStack max="full" gap="sm" align="start">
            <SectionHeading
              bare
              size="display"
              eyebrow={eyebrow}
              title={title}
              align="start"
              className="items-start text-left"
            />
            {description ? (
              <div className="text-fg-muted max-w-md text-base leading-[1.55] md:text-lg md:tracking-[-0.015em]">
                {description}
              </div>
            ) : null}
          </MarketingStack>
          <PageIllustration
            kind={formKind === 'contact' ? 'contact' : 'demo'}
            className="mt-8 max-w-lg"
          />
        </Reveal>

        <Reveal onMount delay={0.05} className="flex flex-col">
          {submitted ? (
            <div
              role="status"
              className="flex flex-col items-center gap-3 py-8 text-center"
            >
              <CheckCircle2 className="text-success h-10 w-10" aria-hidden />
              <h2
                ref={successRef}
                tabIndex={-1}
                className="text-fg-base text-lg font-semibold outline-none"
              >
                {t('success.title')}
              </h2>
              <p className="text-fg-muted text-sm">
                {t('success.description')}
              </p>
              <MarketingButton
                tone="secondary"
                size="lg"
                onClick={() => {
                  form.setValue('startedAt', Date.now(), {
                    shouldValidate: false,
                  });
                  setServerError(null);
                  setSubmitted(false);
                }}
                className="mt-2"
              >
                {t('success.sendAnother')}
              </MarketingButton>
            </div>
          ) : (
            <FormProvider {...form}>
              <form
                ref={formRef}
                onSubmit={onSubmit}
                className="border-border-base bg-surface-site-raised flex min-w-0 flex-col gap-8 rounded-2xl border p-6 md:p-8 [&_input:not([type=checkbox])]:min-h-11"
                noValidate
              >
                {/* Honeypot field — hidden from real users. */}
                <div aria-hidden className="hidden" tabIndex={-1}>
                  <label>
                    {t('honeypotLabel')}
                    <input
                      type="text"
                      autoComplete="off"
                      tabIndex={-1}
                      {...form.register('website')}
                    />
                  </label>
                </div>

                <div className="flex flex-col gap-6">{children}</div>

                <Controller
                  name="privacy"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <FieldShell
                      error={
                        fieldState.error ? (
                          <p
                            id={privacyErrorId}
                            role="alert"
                            className="text-destructive text-xs"
                          >
                            {t('privacyRequired')}
                          </p>
                        ) : undefined
                      }
                    >
                      <div className="text-fg-muted flex min-h-11 items-start gap-3 text-sm leading-5">
                        <Checkbox
                          ref={field.ref}
                          id={privacyId}
                          name={field.name}
                          required
                          checked={Boolean(field.value)}
                          onBlur={field.onBlur}
                          onCheckedChange={(checked) =>
                            field.onChange(checked === true)
                          }
                          aria-labelledby={privacyLabelId}
                          aria-describedby={
                            fieldState.error ? privacyErrorId : undefined
                          }
                          aria-invalid={Boolean(fieldState.error)}
                          className="mt-0.5"
                        />
                        <span id={privacyLabelId}>
                          <label htmlFor={privacyId} className="cursor-pointer">
                            {t('privacyPrefix')}
                          </label>{' '}
                          <a
                            href={localizedPath(
                              locale,
                              '/legal/privacy-policy',
                            )}
                            className="text-fg-base focus-visible:outline-fg-base rounded-sm font-medium underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4"
                          >
                            {t('privacyLink')}
                          </a>
                        </span>
                      </div>
                    </FieldShell>
                  )}
                />

                {serverError ? (
                  <p
                    role="alert"
                    className={cn(
                      'border-danger/30 bg-danger-bg text-danger rounded-md border px-3 py-2 text-sm',
                    )}
                  >
                    {serverError.kind === 'tooFast'
                      ? t('errors.tooFast')
                      : formSubmitErrorMessage(
                          serverError.status,
                          t,
                          serverError.code,
                        )}
                  </p>
                ) : null}

                <MarketingButton
                  type="submit"
                  size="lg"
                  isLoading={form.formState.isSubmitting}
                  fullWidth
                >
                  {submitLabel}
                </MarketingButton>
              </form>
            </FormProvider>
          )}
        </Reveal>
      </div>
    </PageSection>
  );
}
