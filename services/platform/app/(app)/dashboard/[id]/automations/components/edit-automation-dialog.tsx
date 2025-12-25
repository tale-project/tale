'use client';

import { useState, useEffect } from 'react';
import { FormModal } from '@/components/ui/modals';
import { Input } from '@/components/ui/input';
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
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    timeout: 300000,
    maxRetries: 3,
    backoffMs: 1000,
    variables: '{\n "environment": "test" \n}',
  });
  const [isLoading, setIsLoading] = useState(false);

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

  if (!workflow) return null;

  return (
    <FormModal
      open={open}
      onOpenChange={onOpenChange}
      title={t('editDialog.title')}
      submitText={t('editDialog.updateButton')}
      submittingText={t('editDialog.updating')}
      isSubmitting={isLoading}
      onSubmit={handleSubmit}
      large
      className="max-h-[80vh]"
    >
      <Input
        id="edit-name"
        label={t('configuration.name')}
        required
        value={formData.name}
        onChange={(e) =>
          setFormData((prev) => ({ ...prev, name: e.target.value }))
        }
        placeholder={t('editDialog.namePlaceholder')}
        disabled={isLoading}
      />

      <Textarea
        id="edit-description"
        label={t('configuration.description')}
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

      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-2">
          <Input
            id="edit-timeout"
            type="number"
            label={t('configuration.timeout')}
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
          <Input
            id="edit-maxRetries"
            type="number"
            label={t('configuration.maxRetries')}
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
          <Input
            id="edit-backoffMs"
            type="number"
            label={t('configuration.backoff')}
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
    </FormModal>
  );
}
