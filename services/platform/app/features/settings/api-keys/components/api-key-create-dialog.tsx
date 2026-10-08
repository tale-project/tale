'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@tale/ui/button';
import { FormDialog } from '@tale/ui/dialog/form-dialog';
import { FormSection } from '@tale/ui/form-section';
import { Input } from '@tale/ui/input';
import { Text } from '@tale/ui/text';
import { useForm } from '@tale/ui/use-form';
import { useToast } from '@tale/ui/use-toast';
import dayjs from 'dayjs';
import { Copy, Check } from 'lucide-react';
import { useEffect, useMemo, useState, type RefObject } from 'react';
import * as z from 'zod';

import { failureDetail } from '@/app/lib/backend/adapters';
import { useT } from '@/lib/i18n/client';

import { useCreateApiKey } from '../hooks/use-api-keys';
import {
  API_KEY_EXPIRY_CHOICES,
  type ApiKeyExpiryChoice,
  DEFAULT_API_KEY_EXPIRY,
  DEFAULT_CUSTOM_EXPIRY_DAYS,
  expirySeconds,
  isCustomExpiryInRange,
} from '../lib/expiry';
import { ApiKeyExpiryField } from './api-key-expiry-field';

/** Better Auth's apiKey plugin caps the key name at its `maximumNameLength`
 *  default (32) — `convex/auth.ts` sets no override. Mirror it client-side so a
 *  too-long name is rejected inline instead of returning a generic 400 toast. */
const API_KEY_NAME_MAX = 32;

interface ApiKeyCreateDialogProps {
  restoreFocusRef?: RefObject<HTMLElement | null>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  onSuccess?: () => void;
}

type ApiKeyFormData = {
  name: string;
  expiry: ApiKeyExpiryChoice;
  /** The day picked under "Custom date" (local midnight, ms), or null. */
  expiryDate: number | null;
};

export function ApiKeyCreateDialog({
  open,
  onOpenChange,
  organizationId,
  onSuccess,
  restoreFocusRef,
}: ApiKeyCreateDialogProps) {
  const { t: tSettings } = useT('settings');
  const { t: tCommon } = useT('common');
  const { toast } = useToast();
  const { mutateAsync: createKey, isPending: isSubmitting } =
    useCreateApiKey(organizationId);

  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Hold the preview steady while editing; submission checks the live time.
  const [openedAt, setOpenedAt] = useState(() => Date.now());
  useEffect(() => {
    if (open) setOpenedAt(Date.now());
  }, [open]);

  const nameRequiredError = tSettings('apiKeys.form.nameRequired');
  const nameTooLongError = tCommon('validation.maxLength', {
    field: tSettings('apiKeys.form.name'),
    max: API_KEY_NAME_MAX,
  });
  const expiryDateRequiredError = tSettings('apiKeys.form.expiryDateRequired');
  const expiryDateRangeError = tSettings('apiKeys.form.expiryDateRange');
  const schema = useMemo(
    () =>
      z
        .object({
          name: z
            .string()
            .trim()
            .min(1, nameRequiredError)
            .max(API_KEY_NAME_MAX, nameTooLongError),
          expiry: z.enum(API_KEY_EXPIRY_CHOICES),
          expiryDate: z.number().nullable(),
        })
        .superRefine((data, ctx) => {
          if (data.expiry !== 'custom') return;
          if (data.expiryDate === null) {
            ctx.addIssue({
              code: 'custom',
              path: ['expiryDate'],
              message: expiryDateRequiredError,
            });
          } else if (!isCustomExpiryInRange(data.expiryDate, Date.now())) {
            ctx.addIssue({
              code: 'custom',
              path: ['expiryDate'],
              message: expiryDateRangeError,
            });
          }
        }),
    [
      nameRequiredError,
      nameTooLongError,
      expiryDateRequiredError,
      expiryDateRangeError,
    ],
  );

  const form = useForm<ApiKeyFormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      expiry: DEFAULT_API_KEY_EXPIRY,
      expiryDate: null,
    },
  });

  const {
    handleSubmit,
    register,
    reset,
    formState,
    setValue,
    setError,
    watch,
  } = form;
  const expiry = watch('expiry');
  const expiryDate = watch('expiryDate');

  const onSubmit = async (data: ApiKeyFormData) => {
    const now = Date.now();
    const seconds = expirySeconds(data.expiry, data.expiryDate, now);
    // The form may have been left open since the calendar was displayed.
    if (seconds === undefined) {
      setOpenedAt(now);
      setError('expiryDate', { message: expiryDateRangeError });
      return;
    }
    try {
      const result = await createKey({
        name: data.name,
        expiresIn: seconds ?? undefined,
      });

      setCreatedKey(result.key);

      toast({
        title: tSettings('apiKeys.keyCreated'),
        variant: 'success',
      });

      onSuccess?.();
    } catch (error) {
      console.error(error);
      toast({
        title: tSettings('apiKeys.keyCreateFailed'),
        description: failureDetail(error),
        variant: 'destructive',
      });
    }
  };

  const handleCopyKey = async () => {
    if (!createdKey) return;

    try {
      await navigator.clipboard.writeText(createdKey);
      setCopied(true);
      toast({
        title: tSettings('apiKeys.keyCopied'),
        variant: 'success',
      });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({
        title: tCommon('errors.failedToCopy'),
        variant: 'destructive',
      });
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      reset();
      setCreatedKey(null);
      setCopied(false);
    }
    onOpenChange(newOpen);
  };

  if (createdKey) {
    return (
      <FormDialog
        restoreFocusRef={restoreFocusRef}
        open={open}
        onOpenChange={handleOpenChange}
        title={tSettings('apiKeys.keyCreated')}
        submitText={tCommon('actions.done')}
        isSubmitting={false}
        onSubmit={() => handleOpenChange(false)}
        customFooter={
          <Button type="submit" onClick={() => handleOpenChange(false)}>
            {tCommon('actions.done')}
          </Button>
        }
      >
        <FormSection>
          <Text variant="muted">
            {tSettings('apiKeys.keyCreatedDescription')}
          </Text>
          <div className="space-y-2">
            <Text as="label" variant="label">
              {tSettings('apiKeys.yourApiKey')}
            </Text>
            <div className="relative">
              <code className="bg-muted block w-full rounded-md p-3 pr-12 font-mono text-sm break-all">
                {createdKey}
              </code>
              <Button
                type="button"
                variant="ghost"
                onClick={handleCopyKey}
                className="absolute top-1/2 right-2 -translate-y-1/2"
                aria-label={tCommon('actions.copy')}
              >
                {copied ? (
                  <Check className="text-success size-4" />
                ) : (
                  <Copy className="size-4" />
                )}
              </Button>
            </div>
          </div>
        </FormSection>
      </FormDialog>
    );
  }

  return (
    <FormDialog
      restoreFocusRef={restoreFocusRef}
      open={open}
      onOpenChange={handleOpenChange}
      title={tSettings('apiKeys.createKey')}
      submitText={tSettings('apiKeys.createKeySubmit')}
      submittingText={tCommon('actions.loading')}
      isSubmitting={isSubmitting}
      isValid={formState.isValid}
      onSubmit={handleSubmit(onSubmit, () => setOpenedAt(Date.now()))}
    >
      <FormSection>
        {/* A key is the person's, not the organization's — the page lives
            under one organization, so the dialog says what the key spans. */}
        <Text variant="muted">{tSettings('apiKeys.form.scopeHint')}</Text>
        <Input
          id="name"
          label={tSettings('apiKeys.form.name')}
          placeholder={tSettings('apiKeys.form.namePlaceholder')}
          {...register('name')}
          className="w-full"
          required
          errorMessage={formState.errors.name?.message}
        />
        <ApiKeyExpiryField
          choice={expiry}
          customDate={expiryDate}
          now={openedAt}
          onChoiceChange={(choice) => {
            setValue('expiry', choice, {
              shouldDirty: true,
              shouldValidate: true,
            });
            // The calendar opens on a date a month out rather than empty.
            if (choice === 'custom' && expiryDate === null) {
              setValue(
                'expiryDate',
                dayjs(openedAt)
                  .startOf('day')
                  .add(DEFAULT_CUSTOM_EXPIRY_DAYS, 'day')
                  .valueOf(),
                { shouldDirty: true, shouldValidate: true },
              );
            }
          }}
          onCustomDateChange={(date) =>
            setValue('expiryDate', date, {
              shouldDirty: true,
              shouldTouch: true,
              shouldValidate: true,
            })
          }
          customDateError={formState.errors.expiryDate?.message}
        />
      </FormSection>
    </FormDialog>
  );
}
