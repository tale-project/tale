import { zodResolver } from '@hookform/resolvers/zod';
import { Checkbox } from '@tale/ui/checkbox';
import { Field } from '@tale/ui/field';
import { Input } from '@tale/ui/input';
import { buildBreadcrumbListJsonLd } from '@tale/ui/seo/builders/json-ld';
import { Textarea } from '@tale/ui/textarea';
import { useMemo } from 'react';
import { useForm } from 'react-hook-form';

import { FormCard } from '@/app/components/blocks/form-card';
import {
  REQUEST_DEMO_INTERESTS,
  type RequestDemoInput,
  requestDemoSchema,
} from '@/lib/forms/schemas';
import { useT } from '@/lib/i18n/client';
import { useCurrentLocale } from '@/lib/i18n/use-current-locale';
import { absoluteLocalizedUrl } from '@/lib/seo/absolute-url';
import { useDocumentMeta } from '@/lib/seo/use-document-meta';

const defaultValues: RequestDemoInput = {
  name: '',
  email: '',
  phone: '',
  company: '',
  interests: [],
  message: '',
  privacy: false,
  startedAt: 0,
  website: '',
};

const INTEREST_KEY_MAP: Record<
  (typeof REQUEST_DEMO_INTERESTS)[number],
  string
> = {
  enterprise: 'enterprise',
  professional_services: 'professionalServices',
  custom_ai_training: 'customAiTraining',
  ai_hardware: 'aiHardware',
};

export function RequestDemoPage() {
  const { t } = useT('requestDemo');
  const { t: tCommon } = useT('forms');
  const { t: tSeo } = useT('seo');
  const locale = useCurrentLocale();

  const jsonLd = useMemo(
    () => [
      buildBreadcrumbListJsonLd([
        { name: 'Tale', url: absoluteLocalizedUrl(locale, '/') },
        {
          name: tSeo('requestDemo.title'),
          url: absoluteLocalizedUrl(locale, '/request-demo'),
        },
      ]),
    ],
    [locale, tSeo],
  );

  useDocumentMeta({
    title: tSeo('requestDemo.title'),
    description: tSeo('requestDemo.description'),
    path: '/request-demo',
    jsonLd,
  });

  const form = useForm<RequestDemoInput>({
    resolver: zodResolver(requestDemoSchema),
    defaultValues,
    mode: 'onBlur',
  });
  const errors = form.formState.errors;
  const interests = form.watch('interests') ?? [];

  const toggleInterest = (key: (typeof REQUEST_DEMO_INTERESTS)[number]) => {
    const next = interests.includes(key)
      ? interests.filter((i) => i !== key)
      : [...interests, key];
    form.setValue('interests', next, { shouldValidate: true });
  };

  return (
    <FormCard
      eyebrow={t('eyebrow')}
      title={t('title')}
      description={
        <>
          <p>{t('paragraph1')}</p>
          <p className="mt-6">{t('paragraph2')}</p>
        </>
      }
      form={form}
      defaultValues={defaultValues}
      formKind="request-demo"
      submitLabel={t('submit')}
    >
      <Field
        label={t('fieldName')}
        htmlFor="rd-name"
        required
        error={errors.name?.message}
      >
        <Input
          id="rd-name"
          autoComplete="name"
          placeholder={t('placeholderName')}
          aria-invalid={Boolean(errors.name)}
          {...form.register('name')}
        />
      </Field>

      <Field
        label={tCommon('email')}
        htmlFor="rd-email"
        required
        error={errors.email?.message}
      >
        <Input
          id="rd-email"
          type="email"
          autoComplete="email"
          placeholder={t('placeholderEmail')}
          aria-invalid={Boolean(errors.email)}
          {...form.register('email')}
        />
      </Field>

      <Field
        label={t('fieldPhone')}
        htmlFor="rd-phone"
        error={errors.phone?.message}
      >
        <Input
          id="rd-phone"
          type="tel"
          autoComplete="tel"
          placeholder={t('placeholderPhone')}
          aria-invalid={Boolean(errors.phone)}
          {...form.register('phone')}
        />
      </Field>

      <Field
        label={t('fieldCompany')}
        htmlFor="rd-company"
        error={errors.company?.message}
      >
        <Input
          id="rd-company"
          autoComplete="organization"
          placeholder={t('placeholderCompany')}
          aria-invalid={Boolean(errors.company)}
          {...form.register('company')}
        />
      </Field>

      {/* Real grouped control: <fieldset>/<legend> gives the checkbox set an
          accessible group name (Field can only label a single child). */}
      <fieldset className="m-0 min-w-0 border-0 p-0">
        <legend className="text-fg-base text-sm font-medium">
          {t('fieldInterests')}
        </legend>
        <ul role="list" className="mt-2 flex flex-col gap-3">
          {REQUEST_DEMO_INTERESTS.map((key) => (
            <li key={key}>
              <label className="text-fg-base flex items-center gap-2 text-sm">
                <Checkbox
                  checked={interests.includes(key)}
                  onCheckedChange={() => toggleInterest(key)}
                />
                <span>{t(`interests.${INTEREST_KEY_MAP[key]}`)}</span>
              </label>
            </li>
          ))}
        </ul>
        {errors.interests ? (
          <p role="alert" className="text-danger mt-2 text-xs">
            {errors.interests.message as string}
          </p>
        ) : null}
      </fieldset>

      <Field
        label={t('fieldMessage')}
        htmlFor="rd-message"
        error={errors.message?.message}
      >
        <Textarea
          id="rd-message"
          rows={4}
          placeholder={t('placeholderMessage')}
          aria-invalid={Boolean(errors.message)}
          {...form.register('message')}
        />
      </Field>
    </FormCard>
  );
}
