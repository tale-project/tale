import { zodResolver } from '@hookform/resolvers/zod';
import { Checkbox } from '@tale/ui/checkbox';
import { Field } from '@tale/ui/field';
import { Input } from '@tale/ui/input';
import { Textarea } from '@tale/ui/textarea';
import { createFileRoute } from '@tanstack/react-router';
import { useForm } from 'react-hook-form';

import { FormCard } from '@/app/components/blocks/form-card';
import {
  REQUEST_DEMO_INTERESTS,
  type RequestDemoInput,
  requestDemoSchema,
} from '@/lib/forms/schemas';
import { useT } from '@/lib/i18n/client';

export const Route = createFileRoute('/request-demo')({
  component: RequestDemoPage,
});

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
  pro_enterprise: 'proEnterprise',
  professional_services: 'professionalServices',
  custom_ai_training: 'customAiTraining',
  ai_hardware: 'aiHardware',
};

function RequestDemoPage() {
  const { t } = useT('requestDemo');
  const { t: tCommon } = useT('forms');

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
          <p className="mt-3">{t('paragraph2')}</p>
        </>
      }
      // oxlint-disable-next-line typescript/no-explicit-any -- FormCard expects a base shape; runtime payload is shape-compatible
      form={form as any}
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

      <Field
        label={t('fieldInterests')}
        error={errors.interests?.message as string | undefined}
      >
        <ul role="list" className="flex flex-col gap-2">
          {REQUEST_DEMO_INTERESTS.map((key) => (
            <li key={key}>
              <label className="flex items-center gap-3 text-sm text-[color:var(--color-fg-base)]">
                <Checkbox
                  checked={interests.includes(key)}
                  onCheckedChange={() => toggleInterest(key)}
                />
                <span>{t(`interests.${INTEREST_KEY_MAP[key]}`)}</span>
              </label>
            </li>
          ))}
        </ul>
      </Field>

      <Field
        label={t('fieldMessage')}
        htmlFor="rd-message"
        description={t('messageHelp')}
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
