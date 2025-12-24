'use client';

import { useState, useEffect } from 'react';
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
import { JsonInput } from '@/components/ui/json-input';
import { toast } from '@/hooks/use-toast';
import { Doc } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n';

interface AutomationConfig {
  timeout?: number;
  retryPolicy?: { maxRetries?: number; backoffMs?: number };
  variables?: Record<string, unknown>;
}

interface EditAutomationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workflow: Doc<'wfDefinitions'> | null;
  onUpdateAutomation: (
    automationId: string,
    data: {
      name: string;
      description?: string;
      config?: {
        timeout?: number;
        retryPolicy?: {
          maxRetries: number;
          backoffMs: number;
        };
        variables?: Record<string, unknown>;
      };
    },
  ) => Promise<void>;
}

export default function EditAutomationDialog({
  open,
  onOpenChange,
  workflow,
  onUpdateAutomation,
}: EditAutomationDialogProps) {
  const { t } = useT('automations');
  const { t: tCommon } = useT('common');
  const { t: tToast } = useT('toast');
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    timeout: 300000,
    maxRetries: 3,
    backoffMs: 1000,
    variables: '{\n  "environment": "test"\n}',
  });
  const [isLoading, setIsLoading] = useState(false);

  // Update form data when automation changes
  useEffect(() => {
    if (workflow) {
      const config = workflow.config as AutomationConfig;
      setFormData({
        name: workflow.name,
        description: workflow.description || '',
        timeout: config?.timeout || 300000,
        maxRetries: config?.retryPolicy?.maxRetries || 3,
        backoffMs: config?.retryPolicy?.backoffMs || 1000,
        variables: JSON.stringify(
          config?.variables || { environment: 'test' },
          null,
          2,
        ),
      });
    }
  }, [workflow]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!workflow) return;

    if (!formData.name.trim()) {
      toast({
        title: t('configuration.validation.nameRequired'),
        variant: 'destructive',
      });
      return;
    }

    try {
      setIsLoading(true);

      // Parse variables JSON
      let variables: Record<string, unknown> = {};
      if (formData.variables.trim()) {
        try {
          variables = JSON.parse(formData.variables);
        } catch {
          toast({
            title: t('configuration.validation.invalidJson'),
            variant: 'destructive',
          });
          return;
        }
      }

      await onUpdateAutomation(workflow._id, {
        name: formData.name.trim(),
        description: formData.description.trim() || undefined,
        config: {
          timeout: formData.timeout,
          retryPolicy: {
            maxRetries: formData.maxRetries,
            backoffMs: formData.backoffMs,
          },
          variables,
        },
      });

      onOpenChange(false);
    } catch (error) {
      console.error('Failed to update automation:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    if (!isLoading) {
      onOpenChange(false);
    }
  };

  if (!workflow) return null;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md max-h-[80vh] overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{t('editDialog.title')}</DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {/* Name */}
            <div className="space-y-2">
              <Label htmlFor="edit-name">
                {t('configuration.name')} <span className="text-red-500">*</span>
              </Label>
              <Input
                id="edit-name"
                value={formData.name}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, name: e.target.value }))
                }
                placeholder={t('editDialog.namePlaceholder')}
                disabled={isLoading}
              />
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="edit-description">{t('configuration.description')}</Label>
              <Textarea
                id="edit-description"
                value={formData.description}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    description: e.target.value,
                  }))
                }
                placeholder={t('editDialog.descriptionPlaceholder')}
                rows={3}
                disabled={isLoading}
              />
            </div>

            {/* Configuration */}
            <div className="space-y-4">
              {/* Timeout & Retry Policy */}
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-2">
                  <Label htmlFor="edit-timeout">{t('configuration.timeout')}</Label>
                  <Input
                    id="edit-timeout"
                    type="number"
                    value={formData.timeout}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        timeout: parseInt(e.target.value) || 300000,
                      }))
                    }
                    placeholder={t('editDialog.timeoutPlaceholder')}
                    disabled={isLoading}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-maxRetries">{t('configuration.maxRetries')}</Label>
                  <Input
                    id="edit-maxRetries"
                    type="number"
                    value={formData.maxRetries}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        maxRetries: parseInt(e.target.value) || 3,
                      }))
                    }
                    placeholder={t('editDialog.maxRetriesPlaceholder')}
                    disabled={isLoading}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-backoffMs">{t('configuration.backoff')}</Label>
                  <Input
                    id="edit-backoffMs"
                    type="number"
                    value={formData.backoffMs}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        backoffMs: parseInt(e.target.value) || 1000,
                      }))
                    }
                    placeholder={t('editDialog.backoffPlaceholder')}
                    disabled={isLoading}
                  />
                </div>
              </div>

              {/* Variables */}
              <JsonInput
                id="edit-variables"
                label={t('configuration.variables')}
                value={formData.variables}
                onChange={(value) =>
                  setFormData((prev) => ({
                    ...prev,
                    variables: value,
                  }))
                }
                placeholder={t('editDialog.variablesPlaceholder')}
                rows={4}
                disabled={isLoading}
                description={t('editDialog.variablesDescription')}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              className="flex-1"
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={isLoading}
            >
              {tCommon('actions.cancel')}
            </Button>
            <Button type="submit" disabled={isLoading} className="flex-1">
              {isLoading ? t('editDialog.updating') : t('editDialog.updateButton')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
