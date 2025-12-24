'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Pencil } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { toast } from '@/hooks/use-toast';
import { Doc } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n';

const editVendorSchema = z.object({
  name: z.string(),
  email: z.string().email('Invalid email address'),
  locale: z.string(),
});

type EditVendorFormValues = z.infer<typeof editVendorSchema>;

interface EditVendorButtonProps {
  vendor: Doc<'vendors'>;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  asChild?: boolean;
  triggerButton?: React.ReactNode;
}

export default function EditVendorButton({
  vendor,
  isOpen: controlledIsOpen,
  onOpenChange: controlledOnOpenChange,
  asChild = false,
  triggerButton,
}: EditVendorButtonProps) {
  const { t: tCommon } = useT('common');
  const { t: tVendors } = useT('vendors');
  const [internalIsOpen, setInternalIsOpen] = useState(false);

  // Use controlled state if provided, otherwise use internal state
  const isOpen =
    controlledIsOpen !== undefined ? controlledIsOpen : internalIsOpen;
  const setIsOpen = controlledOnOpenChange || setInternalIsOpen;
  const updateVendor = useMutation(api.vendors.updateVendor);

  const form = useForm<EditVendorFormValues>({
    resolver: zodResolver(editVendorSchema),
    defaultValues: {
      name: vendor.name || '',
      email: vendor.email || '',
      locale: vendor.locale || 'en',
    },
  });

  const onSubmit = async (values: EditVendorFormValues) => {
    try {
      await updateVendor({
        vendorId: vendor._id,
        name: values.name,
        email: values.email,
        locale: values.locale,
      });

      toast({
        title: tVendors('updateSuccess'),
        variant: 'success',
      });

      setIsOpen(false);
      form.reset();
    } catch (error) {
      console.error('Error updating vendor:', error);
      toast({
        title: tVendors('updateError'),
        variant: 'destructive',
      });
    }
  };

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (!open) {
      form.reset();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      {!asChild && (
        <DialogTrigger asChild>
          {triggerButton || (
            <Button
              variant="ghost"
              size="icon"
              title={tVendors('editVendor')}
              className="hover:bg-transparent"
            >
              <Pencil className="size-4" />
            </Button>
          )}
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="py-2">{tVendors('editVendor')}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{tVendors('name')}</FormLabel>
                  <FormControl>
                    <Input placeholder={tVendors('namePlaceholder')} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{tVendors('email')}</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      placeholder={tVendors('emailPlaceholder')}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="locale"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{tVendors('locale')}</FormLabel>
                  <FormControl>
                    <Input
                      placeholder={tVendors('localePlaceholder')}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex justify-end space-x-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsOpen(false)}
              >
                {tCommon('actions.cancel')}
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? tCommon('actions.updating') : tVendors('updateVendor')}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
