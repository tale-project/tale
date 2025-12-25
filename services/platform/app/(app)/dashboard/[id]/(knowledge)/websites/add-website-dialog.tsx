'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { FormModal } from '@/components/ui/modals';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Info } from 'lucide-react';
import { useCreateWebsite } from './hooks';
import { toast } from '@/hooks/use-toast';
import { useT } from '@/lib/i18n';

const getFormSchema = (t: (key: string) => string) => z.object({
  domain: z.string().min(1, t('validation.domainRequired')).url(t('validation.validUrl')),
  scanInterval: z.string().min(1, t('validation.scanIntervalRequired')),
});

const asSchemaTranslator = (t: ReturnType<typeof useT>['t']): ((key: string) => string) =>
  t as unknown as (key: string) => string;

type FormData = z.infer<ReturnType<typeof getFormSchema>>;

interface AddWebsiteDialogProps {
  isOpen: boolean;
  onClose: () => void;
  organizationId: string;
}

export default function AddWebsiteDialog({
  isOpen,
  onClose,
  organizationId,
}: AddWebsiteDialogProps) {
  const { t: tWebsites } = useT('websites');
  const [isLoading, setIsLoading] = useState(false);
  const createWebsite = useCreateWebsite();

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
    formState: { errors },
    reset,
    setValue,
    watch,
  } = useForm<FormData>({
    resolver: zodResolver(getFormSchema(asSchemaTranslator(tWebsites))),
    defaultValues: {
      domain: '',
      scanInterval: '6h',
    },
  });

  const scanInterval = watch('scanInterval');

  const onSubmit = async (data: FormData) => {
    setIsLoading(true);
    try {
      await createWebsite({
        organizationId,
        domain: data.domain,
        scanInterval: data.scanInterval,
        status: 'active',
      });

      toast({
        title: tWebsites('toast.addSuccess'),
        variant: 'success',
      });

      reset();
      onClose();
    } catch (error) {
      toast({
        title: error instanceof Error ? error.message : tWebsites('toast.addError'),
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  return (
    <FormModal
      open={isOpen}
      onOpenChange={(open) => !open && handleClose()}
      title={tWebsites('addWebsite')}
      submittingText={tWebsites('adding')}
      isSubmitting={isLoading}
      onSubmit={handleSubmit(onSubmit)}
    >
      <div className="space-y-2">
        <Label htmlFor="domain">{tWebsites('domain')}</Label>
        <Input
          id="domain"
          type="url"
          placeholder={tWebsites('urlPlaceholder')}
          {...register('domain')}
          disabled={isLoading}
        />
        {errors.domain && (
          <p className="text-sm text-destructive">
            {errors.domain.message}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="scanInterval">
          {tWebsites('scanInterval')}
          <Info className="inline-block ml-1 w-3.5 h-3.5 text-muted-foreground" />
        </Label>
        <Select
          value={scanInterval}
          onValueChange={(value) => setValue('scanInterval', value)}
          disabled={isLoading}
        >
          <SelectTrigger id="scanInterval">
            <SelectValue placeholder={tWebsites('scanIntervalPlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            {SCAN_INTERVALS.map((interval) => (
              <SelectItem key={interval.value} value={interval.value}>
                {interval.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors.scanInterval && (
          <p className="text-sm text-destructive">
            {errors.scanInterval.message}
          </p>
        )}
      </div>
    </FormModal>
  );
}
