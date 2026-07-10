import { Button } from '@tale/ui/button';
import { Checkbox } from '@tale/ui/checkbox';
import { cn } from '@tale/ui/cn';
import { Field } from '@tale/ui/field';
import { CheckCircle2 } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import {
  type FieldValues,
  FormProvider,
  type UseFormReturn,
} from 'react-hook-form';

import {
  MarketingStack,
  PageSection,
  Reveal,
  SectionHeading,
} from '@/app/components/marketing';
import { MIN_SUBMIT_DELAY_MS, type SubmitRequest } from '@/lib/forms/schemas';
import { submitForm } from '@/lib/forms/submit-client';
import { formSubmitErrorMessage } from '@/lib/forms/submit-errors';
import { useT } from '@/lib/i18n/client';

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
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  // On success the form (incl. the submit button) unmounts and is replaced by
  // the status block — move focus to its heading so keyboard/AT users aren't
  // stranded on a detached element.
  const successRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (submitted) successRef.current?.focus();
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
      setServerError(t('errors.tooFast'));
      return;
    }

    const result = await submitForm({
      form: formKind,
      payload: values,
    } as SubmitRequest);

    if (!result.ok) {
      setServerError(formSubmitErrorMessage(result.status, t, result.code));
      return;
    }
    setSubmitted(true);
    form.reset(defaultValues);
  });

  return (
    <PageSection pad="xl" border="b" className="relative overflow-hidden">
      <div className="grid gap-10 md:grid-cols-2 md:gap-20">
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
              <Button
                variant="ghost"
                onClick={() => setSubmitted(false)}
                className="mt-2"
              >
                {t('success.sendAnother')}
              </Button>
            </div>
          ) : (
            <FormProvider {...form}>
              <form
                onSubmit={onSubmit}
                className="border-border-base bg-surface-site-raised flex flex-col gap-8 rounded-2xl border p-6 md:p-8"
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

                <Field
                  error={
                    form.formState.errors.privacy
                      ? t('privacyRequired')
                      : undefined
                  }
                >
                  <label className="text-fg-muted flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={Boolean(form.watch('privacy'))}
                      onCheckedChange={(checked) =>
                        form.setValue('privacy', checked === true, {
                          shouldValidate: true,
                        })
                      }
                      aria-invalid={Boolean(form.formState.errors.privacy)}
                    />
                    <span>
                      {t('privacyPrefix')}{' '}
                      <a
                        href="/legal/privacy-policy"
                        className="text-fg-base font-medium underline underline-offset-4"
                      >
                        {t('privacyLink')}
                      </a>
                    </span>
                  </label>
                </Field>

                {serverError ? (
                  <p
                    role="alert"
                    className={cn(
                      'border-danger/30 bg-danger-bg text-danger rounded-md border px-3 py-2 text-sm',
                    )}
                  >
                    {serverError}
                  </p>
                ) : null}

                <Button
                  type="submit"
                  isLoading={form.formState.isSubmitting}
                  fullWidth
                >
                  {submitLabel}
                </Button>
              </form>
            </FormProvider>
          )}
        </Reveal>
      </div>
    </PageSection>
  );
}
