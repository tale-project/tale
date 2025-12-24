'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import {
  useMutation,
  useAction,
  usePreloadedQuery,
  type Preloaded,
} from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/hooks/use-toast';
import ExampleMessagesTable from './components/example-messages-table';
import AddExampleDialog from './components/add-example-dialog';
import ViewEditExampleDialog from './components/view-edit-example-dialog';
import { exampleMessageToUI } from '@/types/tone-of-voice';
import type { ExampleMessageUI } from '@/types/tone-of-voice';
import { useT } from '@/lib/i18n';

interface ToneOfVoiceFormProps {
  organizationId: string;
  preloadedToneOfVoice: Preloaded<
    typeof api.tone_of_voice.getToneOfVoiceWithExamples
  >;
}

interface ToneFormData {
  tone: string;
}

export default function ToneOfVoiceForm({
  organizationId,
  preloadedToneOfVoice,
}: ToneOfVoiceFormProps) {
  const { t: tTone } = useT('toneOfVoice');
  const { t: tCommon } = useT('common');
  const { t: tToast } = useT('toast');
  const orgId = organizationId as string;

  // Use preloaded query for SSR + real-time reactivity
  const toneOfVoiceData = usePreloadedQuery(preloadedToneOfVoice);

  // Mutations
  const addExample = useMutation(api.tone_of_voice.addExampleMessage);
  const updateExample = useMutation(api.tone_of_voice.updateExampleMessage);
  const deleteExample = useMutation(api.tone_of_voice.deleteExampleMessage);
  const upsertTone = useMutation(api.tone_of_voice.upsertToneOfVoice);

  // Actions
  const generateTone = useAction(api.tone_of_voice.generateToneOfVoice);

  // Form for tone of voice
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

  // Convert Convex examples to UI format
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

      // Reset form with the saved value as the new default
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
    <div className="space-y-8">
      {/* Example Messages Section */}
      <ExampleMessagesTable
        examples={examples}
        onAddExample={() => setIsAddDialogOpen(true)}
        onViewExample={handleViewExample}
        onEditExample={handleEditExample}
        onDeleteExample={handleDeleteExample}
      />

      {/* Tone of Voice Section */}
      <form className="space-y-5" onSubmit={handleSubmit(onSubmit)}>
        <div className="flex items-end justify-between">
          <div className="space-y-1">
            <h3 className="text-lg font-semibold text-foreground tracking-[-0.096px]">
              {tTone('form.title')}
              <span className="text-xs text-muted-foreground ml-2">
                {tTone('form.optional')}
              </span>
            </h3>
            <p className="text-sm text-muted-foreground tracking-[-0.084px]">
              {tTone('form.description')}
            </p>
          </div>
        </div>

        {/* Tone Textarea */}
        <div>
          <Textarea
            {...register('tone')}
            defaultValue={toneOfVoiceData?.toneOfVoice?.generatedTone || ''}
            disabled={isSubmitting}
            placeholder={tTone('form.placeholder')}
            className="min-h-[10rem] px-4 py-3 bg-background border border-border rounded-lg shadow-sm text-base text-foreground resize-none"
          />
        </div>
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="outline"
            onClick={handleGenerateTone}
            disabled={isGenerating}
          >
            {isGenerating ? tTone('form.generating') : tTone('form.generateTone')}
          </Button>
          <Button disabled={!isDirty} type="submit">
            {isSubmitting ? tCommon('actions.saving') : tCommon('actions.saveChanges')}
          </Button>
        </div>
      </form>

      {/* Add Example Dialog */}
      <AddExampleDialog
        isOpen={isAddDialogOpen}
        onClose={() => setIsAddDialogOpen(false)}
        onAdd={handleAddExample}
      />

      {/* View/Edit Example Dialog */}
      <ViewEditExampleDialog
        isOpen={viewEditDialog.isOpen}
        onClose={() =>
          setViewEditDialog({ isOpen: false, mode: 'view', example: null })
        }
        mode={viewEditDialog.mode}
        example={viewEditDialog.example}
        onUpdate={handleUpdateExample}
      />
    </div>
  );
}
