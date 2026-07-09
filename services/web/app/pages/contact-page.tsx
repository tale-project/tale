import { zodResolver } from '@hookform/resolvers/zod';
import { Field } from '@tale/ui/field';
import { Input } from '@tale/ui/input';
import { buildBreadcrumbListJsonLd } from '@tale/ui/seo/builders/json-ld';
import { Textarea } from '@tale/ui/textarea';
import { useMemo } from 'react';
import { useForm } from 'react-hook-form';

import { FormCard } from '@/app/components/blocks/form-card';
import { type ContactInput, contactSchema } from '@/lib/forms/schemas';
import { useT } from '@/lib/i18n/client';
import { useCurrentLocale } from '@/lib/i18n/use-current-locale';
import { absoluteLocalizedUrl } from '@/lib/seo/absolute-url';
import { useDocumentMeta } from '@/lib/seo/use-document-meta';

const defaultValues: ContactInput = {
  name: '',
  email: '',
  company: '',
  message: '',
  privacy: false,
  startedAt: 0,
  website: '',
};

export function ContactPage() {
  const { t } = useT('contact');
  const { t: tCommon } = useT('forms');
  const { t: tSeo } = useT('seo');
  const locale = useCurrentLocale();

  const jsonLd = useMemo(
    () => [
      buildBreadcrumbListJsonLd([
        { name: 'Tale', url: absoluteLocalizedUrl(locale, '/') },
        {
          name: tSeo('contact.title'),
          url: absoluteLocalizedUrl(locale, '/contact'),
        },
      ]),
    ],
    [locale, tSeo],
  );

  useDocumentMeta({
    title: tSeo('contact.title'),
    description: tSeo('contact.description'),
    path: '/contact',
    jsonLd,
  });

  const form = useForm<ContactInput>({
    resolver: zodResolver(contactSchema),
    defaultValues,
    mode: 'onBlur',
  });
  const errors = form.formState.errors;

  return (
    <FormCard
      eyebrow={t('eyebrow')}
      title={t('title')}
      description={<p>{t('description')}</p>}
      form={form}
      defaultValues={defaultValues}
      formKind="contact"
      submitLabel={t('submit')}
    >
      <Field
        label={t('fieldName')}
        htmlFor="c-name"
        required
        error={errors.name?.message}
      >
        <Input
          id="c-name"
          autoComplete="name"
          placeholder={t('placeholderName')}
          aria-invalid={Boolean(errors.name)}
          {...form.register('name')}
        />
      </Field>

      <Field
        label={tCommon('email')}
        htmlFor="c-email"
        required
        error={errors.email?.message}
      >
        <Input
          id="c-email"
          type="email"
          autoComplete="email"
          placeholder={t('placeholderEmail')}
          aria-invalid={Boolean(errors.email)}
          {...form.register('email')}
        />
      </Field>

      <Field
        label={t('fieldCompany')}
        htmlFor="c-company"
        error={errors.company?.message}
      >
        <Input
          id="c-company"
          autoComplete="organization"
          placeholder={t('placeholderCompany')}
          aria-invalid={Boolean(errors.company)}
          {...form.register('company')}
        />
      </Field>

      <Field
        label={t('fieldMessage')}
        htmlFor="c-message"
        required
        error={errors.message?.message}
      >
        <Textarea
          id="c-message"
          rows={5}
          placeholder={t('placeholderMessage')}
          aria-invalid={Boolean(errors.message)}
          {...form.register('message')}
        />
      </Field>
    </FormCard>
  );
}
