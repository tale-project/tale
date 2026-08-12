'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo } from 'react';
import * as z from 'zod';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Input } from '@/app/components/ui/forms/input';
import { SegmentedControl } from '@/app/components/ui/forms/segmented-control';
import { Select } from '@/app/components/ui/forms/select';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { useForm } from '@/app/components/ui/forms/use-form';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { convexErrorCode } from '@/lib/utils/convex-error';

import { useCreateWebsite } from '../hooks/mutations';

type FormData = {
  mode: 'site' | 'list';
  domain: string;
  urls: string;
  scanInterval: string;
};

interface AddWebsiteDialogProps {
  isOpen: boolean;
  onClose: () => void;
  organizationId: string;
}

function ensureScheme(value: string): string {
  return value.startsWith('http://') || value.startsWith('https://')
    ? value
    : `https://${value}`;
}

function isValidDomainInput(value: string): boolean {
  try {
    const parsed = new URL(ensureScheme(value));
    return !!parsed.hostname && parsed.hostname.includes('.');
  } catch {
    return false;
  }
}

/**
 * Split a pasted URL list into one group per website. The backend registers
 * one source per domain, so lines are grouped by hostname with the `www.`
 * prefix folded away (the crawler treats www/apex as one site).
 */
function parseUrlList(raw: string): {
  groups: Map<string, string[]>;
  invalid: string[];
} {
  const groups = new Map<string, string[]>();
  const invalid: string[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let parsed: URL;
    try {
      parsed = new URL(ensureScheme(trimmed));
    } catch {
      invalid.push(trimmed);
      continue;
    }
    if (
      (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
      !parsed.hostname.includes('.')
    ) {
      invalid.push(trimmed);
      continue;
    }
    const host = parsed.hostname.toLowerCase();
    const key = host.startsWith('www.') ? host.slice(4) : host;
    const bucket = groups.get(key) ?? [];
    bucket.push(parsed.toString());
    groups.set(key, bucket);
  }
  return { groups, invalid };
}

export function AddWebsiteDialog({
  isOpen,
  onClose,
  organizationId,
}: AddWebsiteDialogProps) {
  const { t: tWebsites } = useT('websites');
  const {
    mutate: createWebsite,
    mutateAsync: createWebsiteAsync,
    isPending,
  } = useCreateWebsite();

  const formSchema = useMemo(
    () =>
      z
        .object({
          mode: z.enum(['site', 'list']),
          domain: z.string(),
          urls: z.string(),
          scanInterval: z
            .string()
            .min(1, tWebsites('validation.scanIntervalRequired')),
        })
        .superRefine((data, ctx) => {
          if (data.mode === 'site') {
            if (data.domain.trim().length === 0) {
              ctx.addIssue({
                code: 'custom',
                path: ['domain'],
                message: tWebsites('validation.domainRequired'),
              });
            } else if (!isValidDomainInput(data.domain)) {
              ctx.addIssue({
                code: 'custom',
                path: ['domain'],
                message: tWebsites('validation.validDomain'),
              });
            }
            return;
          }
          const { groups, invalid } = parseUrlList(data.urls);
          if (invalid.length > 0) {
            ctx.addIssue({
              code: 'custom',
              path: ['urls'],
              message: tWebsites('validation.urlListInvalid', {
                line: invalid[0],
              }),
            });
            return;
          }
          if (groups.size === 0) {
            ctx.addIssue({
              code: 'custom',
              path: ['urls'],
              message: tWebsites('validation.urlListRequired'),
            });
          }
        }),
    [tWebsites],
  );

  const SCAN_INTERVALS = [
    { value: '60m', label: tWebsites('scanIntervals.1hour') },
    { value: '6h', label: tWebsites('scanIntervals.6hours') },
    { value: '12h', label: tWebsites('scanIntervals.12hours') },
    { value: '1d', label: tWebsites('scanIntervals.1day') },
    { value: '5d', label: tWebsites('scanIntervals.5days') },
    { value: '7d', label: tWebsites('scanIntervals.7days') },
    { value: '30d', label: tWebsites('scanIntervals.30days') },
  ];

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
    setValue,
    watch,
  } = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      mode: 'site',
      domain: '',
      urls: '',
      scanInterval: '6h',
    },
  });

  const mode = watch('mode');
  const scanInterval = watch('scanInterval');
  const isLoading = isPending || isSubmitting;

  const submitSite = (data: FormData) => {
    createWebsite(
      {
        organizationId,
        domain: data.domain,
        scanInterval: data.scanInterval,
      },
      {
        onSuccess: () => {
          toast({
            title: tWebsites('toast.addSuccess'),
            variant: 'success',
          });
          reset();
          onClose();
        },
        onError: (error) => {
          console.error('Failed to add website:', error);
          const isDuplicate =
            convexErrorCode(error) === 'WEBSITE_DUPLICATE_DOMAIN';
          toast({
            title: isDuplicate
              ? tWebsites('toast.addErrorDuplicate')
              : tWebsites('toast.addError'),
            variant: 'destructive',
          });
        },
      },
    );
  };

  const submitList = async (data: FormData) => {
    const { groups } = parseUrlList(data.urls);
    const failed: string[] = [];
    let urlCount = 0;
    // One source per domain, registered sequentially. Re-registering merges
    // server-side, so retrying after a partial failure is idempotent.
    for (const [domain, urls] of groups) {
      try {
        await createWebsiteAsync({
          organizationId,
          domain,
          scanInterval: data.scanInterval,
          urls,
        });
        urlCount += urls.length;
      } catch (error) {
        console.error(`Failed to add URL list for ${domain}:`, error);
        failed.push(domain);
      }
    }
    if (failed.length > 0) {
      toast({
        title: tWebsites('toast.addListPartial', {
          domains: failed.join(', '),
        }),
        variant: 'destructive',
      });
      return;
    }
    toast({
      title: tWebsites('toast.addListSuccess', { count: urlCount }),
      variant: 'success',
    });
    reset();
    onClose();
  };

  const onSubmit = async (data: FormData) => {
    if (data.mode === 'site') {
      submitSite(data);
      return;
    }
    await submitList(data);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  return (
    <FormDialog
      open={isOpen}
      onOpenChange={(open) => !open && handleClose()}
      title={tWebsites('addWebsite')}
      submittingText={tWebsites('adding')}
      isSubmitting={isLoading}
      onSubmit={handleSubmit(onSubmit)}
    >
      <SegmentedControl
        id="mode"
        label={tWebsites('addMode.label')}
        value={mode}
        onValueChange={(value) =>
          setValue('mode', value === 'list' ? 'list' : 'site', {
            shouldDirty: true,
          })
        }
        options={[
          { value: 'site', label: tWebsites('addMode.site') },
          { value: 'list', label: tWebsites('addMode.list') },
        ]}
        disabled={isLoading}
      />

      {mode === 'site' ? (
        <Input
          id="domain"
          type="text"
          label={tWebsites('domain')}
          placeholder={tWebsites('urlPlaceholder')}
          {...register('domain')}
          disabled={isLoading}
          errorMessage={errors.domain?.message}
        />
      ) : (
        <Textarea
          id="urls"
          label={tWebsites('urlList')}
          placeholder={tWebsites('urlListPlaceholder')}
          description={tWebsites('urlListHint')}
          rows={6}
          {...register('urls')}
          disabled={isLoading}
          errorMessage={errors.urls?.message}
        />
      )}

      <Select
        value={scanInterval}
        onValueChange={(value) =>
          setValue('scanInterval', value, { shouldDirty: true })
        }
        disabled={isLoading}
        id="scanInterval"
        label={tWebsites('scanInterval')}
        required
        error={!!errors.scanInterval}
        placeholder={tWebsites('scanIntervalPlaceholder')}
        options={SCAN_INTERVALS}
      />
    </FormDialog>
  );
}
