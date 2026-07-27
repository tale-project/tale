'use client';

import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { Field } from '@tale/ui/field';
import { Row, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { useQueryClient } from '@tanstack/react-query';
import { useAction, useMutation } from 'convex/react';
import { FileArchive, FileText, Upload, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { FileUpload } from '@/app/components/ui/forms/file-upload';
import { Select } from '@/app/components/ui/forms/select';
import { useProjects } from '@/app/features/projects/hooks/queries';
import { configKeys } from '@/app/hooks/config-query-keys';
import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import { automationErrorMessage } from '../lib/errors';

/** The org sentinel of the destination picker — not a project id. */
const ORG_TARGET = '__org__';

/** Client-side twin of the server's compressed-size cap (20 MiB). */
const MAX_ZIP_BYTES = 20 * 1024 * 1024;

interface SkillReport {
  slug: string;
  action: 'created' | 'replaced' | 'unchanged';
}

/**
 * "Upload package": the manual lane onto the automation store — a pack's
 * `workflow.yml` (required) and `automation.yml` (optional; its
 * `subjects.task` block becomes the task-surface contract) as plain files, or
 * the whole pack directory as ONE zip, which may also carry skill bundles
 * under `skills/<slug>/`. A zip travels through `_storage` behind the presign
 * + intent handshake; carried skills land in the org's skills library at
 * upload, and a slug that would overwrite a differing existing bundle comes
 * back as a confirmation round-trip before anything is written.
 *
 * The destination is an install target, not a pin: a project choice binds the
 * automation to that project (additively for an existing name), and the
 * automation page's Projects panel manages the set afterwards. The server
 * validates the document with the engine before anything is stored; the
 * uploaded version stays a draft behind the normal deploy gate.
 *
 * Controlled: the trigger lives in the list header's create menu, alongside
 * the builder lane's.
 */
export function UploadAutomationDialog({
  organizationId,
  projectId,
  open,
  onOpenChange,
}: {
  organizationId: string;
  /** Upload into one project's surface (the picker is then fixed). */
  projectId?: Id<'projects'>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useT('automations');
  const filesId = useId();
  const queryClient = useQueryClient();
  const [files, setFiles] = useState<File[]>([]);
  const [target, setTarget] = useState(String(projectId ?? ORG_TARGET));
  const [pending, setPending] = useState(false);
  const [phase, setPhase] = useState<'uploading' | 'validating'>('validating');
  const [refusal, setRefusal] = useState<string | null>(null);
  const [skillConflicts, setSkillConflicts] = useState<string[] | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const { projects } = useProjects(organizationId);
  const upload = useAction(api.automations.upload_action.uploadAutomation);
  const generateUploadUrl = useMutation(
    api.automations.upload_mutations.generateAutomationUploadUrl,
  );
  const recordIntent = useMutation(
    api.automations.upload_mutations.recordAutomationUploadIntent,
  );

  useEffect(() => () => abortRef.current?.abort(), []);

  const zipFile = files.find((file) =>
    file.name.toLowerCase().endsWith('.zip'),
  );
  const mixedZipSelection = zipFile !== undefined && files.length > 1;

  const reset = () => {
    setFiles([]);
    setTarget(projectId ?? ORG_TARGET);
    setRefusal(null);
    setSkillConflicts(null);
    abortRef.current?.abort();
    abortRef.current = null;
  };

  const resolvedProjectId = (): { projectId: Id<'projects'> } | object => {
    const resolvedTarget = projectId ?? target;
    return resolvedTarget !== ORG_TARGET
      ? {
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the value came from the projects listing
          projectId: resolvedTarget as Id<'projects'>,
        }
      : {};
  };

  const finishSuccess = (result: {
    name: string;
    version: number;
    warnings: string[];
    skills: SkillReport[];
  }) => {
    toast({
      title: t('upload.uploaded', {
        name: result.name,
        version: result.version,
      }),
      variant: 'success',
    });
    if (result.skills.length > 0) {
      const count = (action: SkillReport['action']) =>
        result.skills.filter((skill) => skill.action === action).length;
      toast({
        title: t('upload.skillsSummary', {
          created: count('created'),
          replaced: count('replaced'),
          unchanged: count('unchanged'),
        }),
      });
      void queryClient.invalidateQueries({
        queryKey: configKeys.type('skills'),
      });
    }
    if (result.warnings.length > 0) {
      toast({
        title: t('upload.warnings', { count: result.warnings.length }),
      });
    }
    onOpenChange(false);
    reset();
  };

  /** The zip lane: presign → POST the blob → bind the intent → validate. */
  const submitZip = async (file: File, overwriteSkills?: string[]) => {
    if (file.size > MAX_ZIP_BYTES) {
      setRefusal(t('upload.zipTooLarge'));
      return;
    }
    setPhase('uploading');
    const controller = new AbortController();
    abortRef.current = controller;
    const uploadUrl = await generateUploadUrl({ organizationId });
    const response = await fetch(uploadUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/zip' },
      body: file,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`uploading the package failed (HTTP ${response.status})`);
    }
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the presign endpoint's response shape is Convex's own upload contract
    const { storageId } = (await response.json()) as {
      storageId: Id<'_storage'>;
    };
    await recordIntent({ organizationId, storageId });
    setPhase('validating');
    const result = await upload({
      organizationId,
      storageId,
      ...resolvedProjectId(),
      ...(overwriteSkills !== undefined ? { overwriteSkills } : {}),
    });
    if (!result.ok) {
      setSkillConflicts(result.skillConflicts);
      return;
    }
    finishSuccess(result);
  };

  const submitTextFiles = async (picked: File[]) => {
    setPhase('validating');
    const payload = await Promise.all(
      picked.map(async (file) => ({
        name: file.name,
        content: await file.text(),
      })),
    );
    const result = await upload({
      organizationId,
      files: payload,
      ...resolvedProjectId(),
    });
    // The text lane cannot carry skills, so it never asks for confirmation.
    if (result.ok) finishSuccess(result);
  };

  const run = async (overwriteSkills?: string[]) => {
    if (pending || files.length === 0) return;
    if (mixedZipSelection) {
      setRefusal(t('upload.zipOnly'));
      return;
    }
    setPending(true);
    setRefusal(null);
    setSkillConflicts(null);
    try {
      if (zipFile !== undefined) {
        await submitZip(zipFile, overwriteSkills);
      } else {
        await submitTextFiles(files);
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        setRefusal(automationErrorMessage(error));
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
      title={t('upload.title')}
      description={t('upload.description')}
      submitText={t('upload.submit')}
      submittingText={
        phase === 'uploading' ? t('upload.uploading') : t('upload.submitting')
      }
      isSubmitting={pending}
      isValid={
        files.length > 0 && !mixedZipSelection && skillConflicts === null
      }
      isDirty={files.length > 0}
      confirmDiscardOnDirty
      onSubmit={(event) => {
        event.preventDefault();
        void run();
      }}
    >
      <Stack gap={4}>
        {refusal !== null && (
          <Alert variant="destructive" description={refusal} />
        )}

        {skillConflicts !== null && (
          <Alert
            variant="warning"
            description={
              <Stack gap={2}>
                <Text as="p" className="font-medium">
                  {t('upload.skillConflictTitle', {
                    count: skillConflicts.length,
                  })}
                </Text>
                <Text as="p" variant="muted" className="text-xs">
                  {t('upload.skillConflictDescription')}
                </Text>
                <ul className="list-disc pl-4 text-sm">
                  {skillConflicts.map((slug) => (
                    <li key={slug}>{slug}</li>
                  ))}
                </ul>
                <Row gap={2}>
                  <Button
                    type="button"
                    size="sm"
                    disabled={pending}
                    onClick={() => void run(skillConflicts)}
                    data-testid="confirm-skill-overwrite"
                  >
                    {t('upload.skillConflictConfirm', {
                      count: skillConflicts.length,
                    })}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => setSkillConflicts(null)}
                  >
                    {t('upload.skillConflictCancel')}
                  </Button>
                </Row>
              </Stack>
            }
          />
        )}

        <Field label={t('upload.filesLabel')} htmlFor={filesId}>
          <FileUpload.Root>
            <FileUpload.DropZone
              onFilesSelected={(picked) => {
                setFiles(picked);
                setRefusal(null);
                setSkillConflicts(null);
              }}
              accept=".yml,.yaml,.json,.zip"
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
        {mixedZipSelection && (
          <Alert variant="destructive" description={t('upload.zipOnly')} />
        )}
        {files.length > 0 && (
          <ul className="flex flex-col gap-1">
            {files.map((file) => (
              <li key={file.name}>
                <Row gap={2} align="center" className="min-w-0 text-sm">
                  {file.name.toLowerCase().endsWith('.zip') ? (
                    <FileArchive
                      className="text-muted-foreground size-4 shrink-0"
                      aria-hidden
                    />
                  ) : (
                    <FileText
                      className="text-muted-foreground size-4 shrink-0"
                      aria-hidden
                    />
                  )}
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
