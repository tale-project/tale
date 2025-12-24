'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import z from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { toast } from '@/hooks/use-toast';
import { useT } from '@/lib/i18n';

const formSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
});

interface CreateAutomationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
}

export default function CreateAutomationDialog({
  open,
  onOpenChange,
  organizationId,
}: CreateAutomationDialogProps) {
  const { t } = useT('automations');
  const { t: tCommon } = useT('common');
  const {
    register,
    handleSubmit,
    formState: { isSubmitting, isValid },
  } = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    mode: 'onChange',
  });
  const router = useRouter();

  const createAutomation = useMutation(
    api.wf_definitions.createWorkflowWithStepsPublic,
  );

  const onSubmit = handleSubmit(async (data: z.infer<typeof formSchema>) => {
    try {
      const { workflowId: wfDefinitionId } = await createAutomation({
        organizationId,
        workflowConfig: {
          name: data.name,
          description: data.description,
          config: {},
        },
        stepsConfig: [],
      });
      toast({
        title: 'Automation created successfully',
        variant: 'success',
      });
      router.push(`/dashboard/${organizationId}/automations/${wfDefinitionId}`);
    } catch {
      toast({
        title: 'Failed to create automation',
        variant: 'destructive',
      });
    }
  });

  const handleClose = () => {
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="!p-0 gap-0">
        <form onSubmit={onSubmit}>
          <DialogHeader className="px-4 py-6 border-b border-border">
            <DialogTitle>{t('createDialog.title')}</DialogTitle>
          </DialogHeader>

          <div className="space-y-6 px-4 py-4">
            {/* Name */}
            <div className="space-y-2">
              <Label htmlFor="name">{t('configuration.name')}</Label>
              <Input
                id="name"
                {...register('name')}
                placeholder={t('createDialog.namePlaceholder')}
              />
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="description">
                {t('configuration.description')}{' '}
                <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Textarea
                id="description"
                {...register('description')}
                placeholder={t('createDialog.descriptionPlaceholder')}
                rows={3}
              />
            </div>
          </div>

          <DialogFooter className="grid grid-cols-2 justify-items-stretch p-4 border-t border-border">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={isSubmitting}
            >
              {tCommon('actions.cancel')}
            </Button>
            <Button type="submit" disabled={isSubmitting || !isValid}>
              {isSubmitting ? t('createDialog.creating') : t('createDialog.continue')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
