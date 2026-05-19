import { Button } from '@tale/ui/button';
import { Checkbox } from '@tale/ui/checkbox';
import { cn } from '@tale/ui/cn';
import { Container } from '@tale/ui/container';
import { Field } from '@tale/ui/field';
import { Section } from '@tale/ui/section';
import { motion, useReducedMotion } from 'framer-motion';
import { CheckCircle2 } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import {
  type FieldValues,
  FormProvider,
  type UseFormReturn,
} from 'react-hook-form';

import { MIN_SUBMIT_DELAY_MS, type SubmitRequest } from '@/lib/forms/schemas';
import { submitForm } from '@/lib/forms/submit-client';
import { useT } from '@/lib/i18n/client';

const easeOut = [0.22, 1, 0.36, 1] as const;

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
  const reduceMotion = useReducedMotion();
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

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
      setServerError(
        result.status === 429 ? t('errors.rateLimited') : t('errors.generic'),
      );
      return;
    }
    setSubmitted(true);
    form.reset(defaultValues);
  });

  return (
    <Section spacing="md">
      <Container size="lg">
        <div className="grid gap-10 md:grid-cols-2 md:gap-20">
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={
              reduceMotion ? { duration: 0 } : { duration: 0.5, ease: easeOut }
            }
            className="flex flex-col gap-6"
          >
            {eyebrow ? (
              <p className="text-xs font-semibold tracking-wider text-[color:var(--color-fg-muted)] uppercase">
                {eyebrow}
              </p>
            ) : null}
            <h1 className="text-accent-base text-[2rem] font-medium tracking-tight md:text-5xl md:tracking-[-0.02em]">
              {title}
            </h1>
            {description ? (
              <div className="text-fg-muted text-base leading-[1.55] md:text-lg md:tracking-[-0.015em]">
                {description}
              </div>
            ) : null}
          </motion.div>

          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={
              reduceMotion
                ? { duration: 0 }
                : { duration: 0.5, delay: 0.05, ease: easeOut }
            }
            className="flex flex-col"
          >
            {submitted ? (
              <div
                role="status"
                className="flex flex-col items-center gap-3 py-8 text-center"
              >
                <CheckCircle2
                  className="h-10 w-10 text-[color:var(--color-success)]"
                  aria-hidden
                />
                <h2 className="text-lg font-semibold text-[color:var(--color-fg-base)]">
                  {t('success.title')}
                </h2>
                <p className="text-sm text-[color:var(--color-fg-muted)]">
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
                  className="flex flex-col gap-8"
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
                          className="text-fg-muted font-semibold underline underline-offset-4"
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
                        'rounded-md border border-[color:var(--color-danger)]/30 bg-[color:var(--color-danger-bg)] px-3 py-2 text-sm text-[color:var(--color-danger)]',
                      )}
                    >
                      {serverError}
                    </p>
                  ) : null}

                  <Button
                    type="submit"
                    isLoading={form.formState.isSubmitting}
                    fullWidth
                    size="lg"
                  >
                    {submitLabel}
                  </Button>
                </form>
              </FormProvider>
            )}
          </motion.div>
        </div>
      </Container>
    </Section>
  );
}
