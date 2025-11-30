'use client';

import { useState } from 'react';
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
import { Info } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

const formSchema = z.object({
  domain: z.string().min(1, 'Domain is required').url('Must be a valid URL'),
  scanInterval: z.string().min(1, 'Scan interval is required'),
});

type FormData = z.infer<typeof formSchema>;

interface AddWebsiteDialogProps {
  isOpen: boolean;
  onClose: () => void;
  organizationId: string;
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

export default function AddWebsiteDialog({
  isOpen,
  onClose,
  organizationId,
}: AddWebsiteDialogProps) {
  const [isLoading, setIsLoading] = useState(false);
  const createWebsite = useMutation(api.websites.createWebsite);

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
        title: 'Website added successfully',
        variant: 'success',
      });

      reset();
      onClose();
    } catch (error) {
      toast({
        title: error instanceof Error ? error.message : 'Failed to add website',
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
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="py-2">Add website</DialogTitle>
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
              <Info className="inline-block ml-1 w-3.5 h-3.5 text-muted-foreground" />
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
              onClick={handleClose}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? 'Adding...' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
