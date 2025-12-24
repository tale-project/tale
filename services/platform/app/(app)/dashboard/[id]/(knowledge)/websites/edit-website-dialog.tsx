'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Doc } from '@/convex/_generated/dataModel';
import { InfoCircleIcon } from '@/components/ui/icons';
import { toast } from '@/hooks/use-toast';
import { useT } from '@/lib/i18n';

const getFormSchema = (t: (key: string) => string) => z.object({
  domain: z.string().min(1, t('validation.domainRequired')).url(t('validation.validUrl')),
  scanInterval: z.string().min(1, t('validation.scanIntervalRequired')),
});

// Helper to cast translation function for zod schema
const asSchemaTranslator = (t: ReturnType<typeof useT>['t']): ((key: string) => string) =>
  t as unknown as (key: string) => string;

type FormData = z.infer<ReturnType<typeof getFormSchema>>;

interface EditWebsiteDialogProps {
  isOpen: boolean;
  onClose: () => void;
  website: Doc<'websites'>;
}

export default function EditWebsiteDialog({
  isOpen,
  onClose,
  website,
}: EditWebsiteDialogProps) {
  const { t: tCommon } = useT('common');
  const { t: tWebsites } = useT('websites');
  const [isLoading, setIsLoading] = useState(false);
  const updateWebsite = useMutation(api.websites.updateWebsite);

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
      domain: website.domain,
      scanInterval: website.scanInterval,
    },
  });

  const scanInterval = watch('scanInterval');

  // Update form when website changes
  useEffect(() => {
    if (website) {
      reset({
        domain: website.domain,
        scanInterval: website.scanInterval,
      });
    }
  }, [website, reset]);

  const onSubmit = async (data: FormData) => {
    setIsLoading(true);
    try {
      await updateWebsite({
        websiteId: website._id,
        domain: data.domain,
        scanInterval: data.scanInterval,
      });

      toast({
        title: tWebsites('toast.updateSuccess'),
        variant: 'success',
      });

      onClose();
    } catch (error) {
      toast({
        title:
          error instanceof Error ? error.message : tWebsites('toast.updateError'),
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="py-2">{tWebsites('editWebsite')}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
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
              <InfoCircleIcon className="inline-block ml-1 w-3.5 h-3.5 text-muted-foreground" />
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

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isLoading}
            >
              {tCommon('actions.cancel')}
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? tWebsites('saving') : tCommon('actions.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
