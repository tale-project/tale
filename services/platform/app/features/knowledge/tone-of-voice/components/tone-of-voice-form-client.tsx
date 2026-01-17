'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { Id, Doc } from '@/convex/_generated/dataModel';
import { useAddExample } from '../hooks/use-add-example';
import { useUpdateExample } from '../hooks/use-update-example';
import { useDeleteExample } from '../hooks/use-delete-example';
import { useUpsertTone } from '../hooks/use-upsert-tone';
import { useGenerateTone } from '../hooks/use-generate-tone';
import { Button } from '@/app/components/ui/primitives/button';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { Form } from '@/app/components/ui/forms/form';
import { Stack, HStack } from '@/app/components/ui/layout/layout';
import { toast } from '@/app/hooks/use-toast';
import { ExampleMessagesTable } from './example-messages-table';
import { AddExampleDialog } from './example-add-dialog';
import { ViewEditExampleDialog } from './example-view-edit-dialog';
import { exampleMessageToUI } from '@/types/tone-of-voice';
import type { ExampleMessageUI } from '@/types/tone-of-voice';
import { useT } from '@/lib/i18n/client';

type ToneOfVoiceWithExamples = {
  toneOfVoice: Doc<'toneOfVoice'> | null;
  examples: Doc<'exampleMessages'>[];
} | null;

interface ToneOfVoiceFormClientProps {
  organizationId: string;
  toneOfVoice: ToneOfVoiceWithExamples;
}

interface ToneFormData {
  tone: string;
}

export function ToneOfVoiceFormClient({
  organizationId,
  toneOfVoice: toneOfVoiceData,
}: ToneOfVoiceFormClientProps) {
  const { t: tTone } = useT('toneOfVoice');
  const { t: tCommon } = useT('common');
  const { t: tToast } = useT('toast');
  const orgId = organizationId;

  const addExample = useAddExample();
  const updateExample = useUpdateExample();
  const deleteExample = useDeleteExample();
  const upsertTone = useUpsertTone();
  const generateTone = useGenerateTone();

  const form = useForm<ToneFormData>();
  const { register, setValue, watch, formState, handleSubmit } = form;
  const { isDirty, isSubmitting } = formState;
  const _toneValue = watch('tone');

  const [isGenerating, setIsGenerating] = useState(false);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [viewEditDialog, setViewEditDialog] = useState<{
    isOpen: boolean;
    mode: 'view' | 'edit';
    example: ExampleMessageUI | null;
  }>({
    isOpen: false,
    mode: 'view',
    example: null,
  });

  const examples: ExampleMessageUI[] =
    toneOfVoiceData?.examples.map(exampleMessageToUI) || [];

  const handleAddExample = async (newExample: { content: string }) => {
    try {
      await addExample({
        organizationId: orgId,
        content: newExample.content,
      });
      toast({
        title: tToast('success.exampleAdded'),
        variant: 'success',
      });
    } catch (error) {
      console.error('Error adding example:', error);
      toast({
        title: tToast('error.exampleAddFailed'),
        variant: 'destructive',
      });
      throw error;
    }
  };

  const handleViewExample = (example: ExampleMessageUI) => {
    setViewEditDialog({
      isOpen: true,
      mode: 'view',
      example,
    });
  };

  const handleEditExample = (example: ExampleMessageUI) => {
    setViewEditDialog({
      isOpen: true,
      mode: 'edit',
      example,
    });
  };

  const handleUpdateExample = async (exampleId: string, content: string) => {
    try {
      await updateExample({
        messageId: exampleId as Id<'exampleMessages'>,
        content,
      });
      toast({
        title: tToast('success.exampleUpdated'),
        variant: 'success',
      });
    } catch (error) {
      console.error('Error updating example:', error);
      toast({
        title: tToast('error.exampleUpdateFailed'),
        variant: 'destructive',
      });
      throw error;
    }
  };

  const handleDeleteExample = async (exampleId: string) => {
    try {
      await deleteExample({
        messageId: exampleId as Id<'exampleMessages'>,
      });
    } catch (error) {
      console.error('Error deleting example:', error);
      toast({
        title: tToast('error.exampleDeleteFailed'),
        variant: 'destructive',
      });
      throw error;
    }
  };

  const handleGenerateTone = async () => {
    try {
      setIsGenerating(true);

      if (examples.length === 0) {
        toast({
          title: tToast('error.noExampleMessages'),
          description: tToast('error.addExampleFirst'),
          variant: 'destructive',
        });
        return;
      }

      const result = await generateTone({
        organizationId: orgId,
      });

      if (result.success && result.tone) {
        setValue('tone', result.tone, { shouldDirty: false });
        toast({
          title: tToast('success.toneGenerated'),
          variant: 'success',
        });
      } else {
        toast({
          title: tToast('error.toneGenerateFailed'),
          variant: 'destructive',
        });
      }
    } catch (error) {
      console.error('Error generating tone:', error);
      toast({
        title: tToast('error.toneGenerateFailed'),
        variant: 'destructive',
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const onSubmit = async (data: ToneFormData) => {
    try {
      await upsertTone({
        organizationId: orgId,
        generatedTone: data.tone.trim(),
      });

      setValue('tone', data.tone.trim(), { shouldDirty: false });

      toast({
        title: tToast('success.toneSaved'),
        variant: 'success',
      });
    } catch (error) {
      console.error('Error saving tone:', error);
      toast({
        title: tToast('error.toneSaveFailed'),
        variant: 'destructive',
      });
    }
  };

  return (
    <Stack gap={8}>
      <ExampleMessagesTable
        examples={examples}
        onAddExample={() => setIsAddDialogOpen(true)}
        onViewExample={handleViewExample}
        onEditExample={handleEditExample}
        onDeleteExample={handleDeleteExample}
      />

      <Form onSubmit={handleSubmit(onSubmit)}>
        <HStack align="end" justify="between">
          <Stack gap={1}>
            <h3 className="text-lg font-semibold text-foreground tracking-[-0.096px]">
              {tTone('form.title')}
              <span className="text-xs text-muted-foreground ml-2">
                {tTone('form.optional')}
              </span>
            </h3>
            <p className="text-sm text-muted-foreground tracking-[-0.084px]">
              {tTone('form.description')}
            </p>
          </Stack>
        </HStack>

        <Textarea
          {...register('tone')}
          defaultValue={toneOfVoiceData?.toneOfVoice?.generatedTone || ''}
          disabled={isSubmitting}
          placeholder={tTone('form.placeholder')}
          className="min-h-[10rem] px-4 py-3 bg-background border border-border rounded-lg shadow-sm text-base text-foreground resize-none"
        />
        <HStack gap={2} justify="end">
          <Button
            variant="outline"
            onClick={handleGenerateTone}
            disabled={isGenerating}
          >
            {isGenerating ? tTone('form.generating') : tTone('form.generateTone')}
          </Button>
          <Button disabled={!isDirty} type="submit">
            {isSubmitting
              ? tCommon('actions.saving')
              : tCommon('actions.saveChanges')}
          </Button>
        </HStack>
      </Form>

      <AddExampleDialog
        isOpen={isAddDialogOpen}
        onClose={() => setIsAddDialogOpen(false)}
        onAdd={handleAddExample}
      />

      <ViewEditExampleDialog
        isOpen={viewEditDialog.isOpen}
        onClose={() =>
          setViewEditDialog({ isOpen: false, mode: 'view', example: null })
        }
        mode={viewEditDialog.mode}
        example={viewEditDialog.example}
        onUpdate={handleUpdateExample}
      />
    </Stack>
  );
}
