'use client';

import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { Field } from '@tale/ui/field';
import { Row, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { useAction } from 'convex/react';
import { FileText, Upload, X } from 'lucide-react';
import { useId, useState } from 'react';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { FileUpload } from '@/app/components/ui/forms/file-upload';
import { Select } from '@/app/components/ui/forms/select';
import { useProjects } from '@/app/features/projects/hooks/queries';
import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import { automationErrorMessage } from '../lib/errors';

/** The org sentinel of the destination picker — not a project id. */
const ORG_TARGET = '__org__';

/**
 * "Upload package": the manual lane onto the automation store — a pack's
 * `workflow.yml` (required) and `automation.yml` (optional; its
 * `subjects.task` block becomes the task-surface contract), bound to the
 * organization or to ONE project. Binding is the store's install semantics:
 * the first save pins the automation name to the chosen surface for good, so
 * the destination is picked HERE, not moved later. The server validates the
 * document with the engine before anything is stored; the uploaded version
 * stays a draft behind the normal deploy gate.
 */
export function UploadAutomationDialog({
  organizationId,
  projectId,
}: {
  organizationId: string;
  /** Upload into one project's surface (the picker is then fixed). */
  projectId?: Id<'projects'>;
}) {
  const { t } = useT('automations');
  const filesId = useId();
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [target, setTarget] = useState(String(projectId ?? ORG_TARGET));
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const { projects } = useProjects(organizationId);
  const upload = useAction(api.automations.upload_action.uploadAutomation);

  const reset = () => {
    setFiles([]);
    setTarget(projectId ?? ORG_TARGET);
    setRefusal(null);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pending || files.length === 0) return;
    setPending(true);
    setRefusal(null);
    try {
      const payload = await Promise.all(
        files.map(async (file) => ({
          name: file.name,
          content: await file.text(),
        })),
      );
      const resolvedTarget = projectId ?? target;
      const result = await upload({
        organizationId,
        files: payload,
        ...(resolvedTarget !== ORG_TARGET
          ? {
              // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the value came from the projects listing
              projectId: resolvedTarget as Id<'projects'>,
            }
          : {}),
      });
      toast({
        title: t('upload.uploaded', {
          name: result.name,
          version: result.version,
        }),
        variant: 'success',
      });
      if (result.warnings.length > 0) {
        toast({
          title: t('upload.warnings', { count: result.warnings.length }),
        });
      }
      setOpen(false);
      reset();
    } catch (error) {
      setRefusal(automationErrorMessage(error));
    } finally {
      setPending(false);
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
      title={t('upload.title')}
      description={t('upload.description')}
      submitText={t('upload.submit')}
      submittingText={t('upload.submitting')}
      isSubmitting={pending}
      isValid={files.length > 0}
      isDirty={files.length > 0}
      confirmDiscardOnDirty
      onSubmit={(event) => void handleSubmit(event)}
      trigger={
        <Button
          variant="secondary"
          icon={Upload}
          data-testid="upload-automation"
        >
          {t('upload.trigger')}
        </Button>
      }
    >
      <Stack gap={4}>
        {refusal !== null && (
          <Alert variant="destructive" description={refusal} />
        )}

        <Field label={t('upload.filesLabel')} htmlFor={filesId}>
          <FileUpload.Root>
            <FileUpload.DropZone
              onFilesSelected={(picked) => {
                setFiles(picked);
                setRefusal(null);
              }}
              accept=".yml,.yaml,.json"
              multiple
              disabled={pending}
              inputId={filesId}
              aria-label={t('upload.filesLabel')}
              className="hover:border-primary/50 relative flex cursor-pointer flex-col items-center gap-1 rounded-lg border-2 border-dashed p-4 transition-colors"
            >
              <Upload className="text-muted-foreground size-5" aria-hidden />
              <Text as="p" variant="muted" className="text-xs">
                {t('upload.filesHelp')}
              </Text>
              <FileUpload.Overlay />
            </FileUpload.DropZone>
          </FileUpload.Root>
        </Field>
        {files.length > 0 && (
          <ul className="flex flex-col gap-1">
            {files.map((file) => (
              <li key={file.name}>
                <Row gap={2} align="center" className="min-w-0 text-sm">
                  <FileText
                    className="text-muted-foreground size-4 shrink-0"
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate">{file.name}</span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('upload.removeFile', { name: file.name })}
                    disabled={pending}
                    onClick={() =>
                      setFiles((current) =>
                        current.filter((entry) => entry.name !== file.name),
                      )
                    }
                  >
                    <X className="size-4" aria-hidden />
                  </Button>
                </Row>
              </li>
            ))}
          </ul>
        )}

        {projectId === undefined && (
          <Select
            label={t('upload.targetLabel')}
            value={target}
            onValueChange={setTarget}
            options={[
              { value: ORG_TARGET, label: t('upload.targetOrg') },
              ...projects.map((project) => ({
                value: String(project._id),
                label: project.name,
              })),
            ]}
            disabled={pending}
          />
        )}
        <Text as="p" variant="muted" className="text-xs">
          {t('upload.targetHelp')}
        </Text>
      </Stack>
    </FormDialog>
  );
}
