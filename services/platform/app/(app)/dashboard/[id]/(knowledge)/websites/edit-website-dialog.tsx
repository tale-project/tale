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
import { toast } from '@/hooks/use-toast';

const formSchema = z.object({
  domain: z.string().min(1, 'Domain is required').url('Must be a valid URL'),
  scanInterval: z.string().min(1, 'Scan interval is required'),
});

type FormData = z.infer<typeof formSchema>;

interface EditWebsiteDialogProps {
  isOpen: boolean;
  onClose: () => void;
  website: Doc<'websites'>;
}

const SCAN_INTERVALS = [
  { value: '60m', label: 'Every 1 hour' },
  { value: '6h', label: 'Every 6 hours' },
  { value: '12h', label: 'Every 12 hours' },
  { value: '1d', label: 'Every 1 day' },
  { value: '5d', label: 'Every 5 days' },
  { value: '7d', label: 'Every 7 days' },
  { value: '30d', label: 'Every 30 days' },
];

export default function EditWebsiteDialog({
  isOpen,
  onClose,
  website,
}: EditWebsiteDialogProps) {
  const [isLoading, setIsLoading] = useState(false);
  const updateWebsite = useMutation(api.websites.updateWebsite);

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    setValue,
    watch,
  } = useForm<FormData>({
    resolver: zodResolver(formSchema),
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
        title: 'Website updated successfully',
        variant: 'success',
      });

      onClose();
    } catch (error) {
      toast({
        title:
          error instanceof Error ? error.message : 'Failed to update website',
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
          <DialogTitle className="py-2">Edit website</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="domain">Domain</Label>
            <Input
              id="domain"
              type="url"
              placeholder="example.com"
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
              Scan interval
              <svg
                className="inline-block ml-1 w-3.5 h-3.5 text-muted-foreground"
                fill="none"
                viewBox="0 0 16 16"
              >
                <circle cx="8" cy="8" r="6.5" stroke="currentColor" />
                <path
                  d="M8 6v3m0 2h.01"
                  stroke="currentColor"
                  strokeLinecap="round"
                />
              </svg>
            </Label>
            <Select
              value={scanInterval}
              onValueChange={(value) => setValue('scanInterval', value)}
              disabled={isLoading}
            >
              <SelectTrigger id="scanInterval">
                <SelectValue placeholder="Select scan interval" />
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
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
