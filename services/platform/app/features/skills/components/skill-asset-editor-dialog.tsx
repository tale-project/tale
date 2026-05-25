'use client';

import { Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { useQueryClient } from '@tanstack/react-query';
import { ConvexError } from 'convex/values';
import { useEffect, useState } from 'react';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Input } from '@/app/components/ui/forms/input';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { isRecord } from '@/lib/utils/type-guards';

import { useWriteSkillAsset } from '../hooks/mutations';
import { useReadSkillAsset } from '../hooks/queries';

interface SkillAssetEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  skillSlug: string;
  /** When set, edit mode — path is fixed and current content is loaded. */
  assetPath: string | null;
}

/**
 * Outer shell — keeps the inner editor mounted only while `open` is true,
 * and keys it on the target asset path so React unmounts the form (and
 * resets all local state) on every edit→close→create or edit-A→edit-B
 * transition. This is what plugs the state-pollution + mid-load
 * corruption windows; the previous implementation reused a single
 * mounted form and synced state via effect, which created the
 * "save-while-loading writes A's content to B's path" race.
 */
export function SkillAssetEditorDialog(props: SkillAssetEditorDialogProps) {
  return (
    <SkillAssetEditorForm
      key={`${props.assetPath ?? '__create__'}|${props.open ? 'open' : 'closed'}`}
      {...props}
    />
  );
}

function SkillAssetEditorForm({
  open,
  onOpenChange,
  organizationId,
  skillSlug,
  assetPath,
}: SkillAssetEditorDialogProps) {
  const { t } = useT('settings');
  // Save/Saving labels live in the `common` namespace under `actions`.
  // Earlier this file passed `'common.save'` into the settings-scoped
  // `t()` which never resolved, so de/fr saw the literal key string.
  const { t: tCommon } = useT('common');
  const queryClient = useQueryClient();
  const { mutateAsync: writeAsset } = useWriteSkillAsset();

  const isEditMode = assetPath !== null;
  const [pathInput, setPathInput] = useState('');
  const [content, setContent] = useState('');
  const [initialContent, setInitialContent] = useState('');
  const [pathError, setPathError] = useState<string | undefined>();
  const [isSaving, setIsSaving] = useState(false);
  const [loadedHash, setLoadedHash] = useState<string | undefined>(undefined);

  // Client-side path validation runs on blur so the user gets immediate
  // feedback for `../`, leading-slash, or unsupported characters instead
  // of waiting for a server round-trip. Server still validates as the
  // trust boundary.
  const validatePath = (raw: string): string | undefined => {
    const value = raw.trim();
    if (value.length === 0) {
      return t('skills.asset.pathRequired', {
        defaultValue: 'Path is required',
      });
    }
    if (value.startsWith('/')) {
      return t('skills.asset.pathNoLeadingSlash', {
        defaultValue:
          'Path must be relative — no leading slash. Use scripts/ / references/ / assets/.',
      });
    }
    if (value.includes('..')) {
      return t('skills.asset.pathNoTraversal', {
        defaultValue: 'Path may not contain "..".',
      });
    }
    if (!/^[a-zA-Z0-9._\-/]+$/.test(value)) {
      return t('skills.asset.pathInvalidChars', {
        defaultValue:
          'Path may only contain letters, digits, dot, hyphen, underscore, and slash.',
      });
    }
    return undefined;
  };

  const { data: assetData } = useReadSkillAsset(
    organizationId,
    skillSlug,
    isEditMode ? assetPath : null,
  );

  // Hydrate state from the loaded asset on edit-mode mount. Because the
  // outer shell keys this component on assetPath, this effect runs once
  // per asset — no risk of a refetch clobbering active edits.
  useEffect(() => {
    if (!isEditMode) return;
    if (assetData?.ok) {
      setPathInput(assetPath);
      setContent(assetData.content);
      // Snapshot the loaded body so the discard-on-close prompt can
      // tell "user typed something" vs "user just opened the dialog".
      setInitialContent(assetData.content);
      setLoadedHash(assetData.hash);
    }
  }, [assetData, assetPath, isEditMode]);

  // "Dirty" semantics for the discard prompt: create-mode is dirty if
  // the user has typed anything; edit-mode is dirty once the textarea
  // diverges from the loaded body. Path changes don't count because
  // edit-mode locks the path and create-mode's path field is just a
  // form input — what matters for "do you want to lose this edit?"
  // is the body content the user has accumulated.
  const isDirty = isEditMode
    ? content !== initialContent
    : content.length > 0 || pathInput.trim().length > 0;

  // Surface `ok:false` states (not_found, too_large) explicitly — saving
  // with stale state on top of a missing/oversized file would otherwise
  // silently overwrite or truncate.
  const loadFailure: 'not_found' | 'too_large' | null =
    isEditMode && assetData && !assetData.ok ? assetData.error : null;
  const isLoading = isEditMode && assetData === undefined;
  const canSave =
    !isSaving &&
    loadFailure === null &&
    !isLoading &&
    (isEditMode ? loadedHash !== undefined : true);

  const handleSave = async () => {
    if (!canSave) return;
    const targetPath = isEditMode ? assetPath : pathInput.trim();
    if (!isEditMode) {
      const pathProblem = validatePath(pathInput);
      if (pathProblem) {
        setPathError(pathProblem);
        return;
      }
    } else if (!targetPath) {
      setPathError(
        t('skills.asset.pathRequired', { defaultValue: 'Path is required' }),
      );
      return;
    }
    setPathError(undefined);
    setIsSaving(true);
    try {
      await writeAsset({
        organizationId,
        slug: skillSlug,
        assetPath: targetPath,
        content,
        ...(loadedHash !== undefined && { expectedHash: loadedHash }),
      });
      toast({
        title: t('skills.asset.saved', { defaultValue: 'File saved' }),
        variant: 'success',
      });
      void queryClient.invalidateQueries({
        queryKey: ['config', 'skills', organizationId, skillSlug],
      });
      onOpenChange(false);
    } catch (error) {
      if (error instanceof ConvexError) {
        // Narrow ConvexError.data through isRecord before reading
        // string fields. Peer feature code uses the same defensive
        // pattern (e.g. thread-voice-output-switch.tsx).
        const data = isRecord(error.data) ? error.data : undefined;
        const code = typeof data?.code === 'string' ? data.code : undefined;
        const message =
          typeof data?.message === 'string' ? data.message : undefined;
        if (code === 'CONFLICT') {
          toast({
            title: t('skills.asset.conflict', {
              defaultValue:
                'This file was edited elsewhere. Reopen to see the latest version.',
            }),
            variant: 'destructive',
          });
          return;
        }
        if (code === 'ALREADY_EXISTS') {
          setPathError(
            message ??
              t('skills.asset.alreadyExists', {
                defaultValue:
                  'A file already exists at this path. Open it from the list to edit, or pick a new path.',
              }),
          );
          return;
        }
        if (
          code === 'BUNDLE_TOO_MANY_FILES' ||
          code === 'BUNDLE_TOO_LARGE' ||
          code === 'TOO_LARGE'
        ) {
          toast({
            title:
              message ??
              t('skills.asset.sizeError', {
                defaultValue: 'File would exceed the bundle size limit',
              }),
            variant: 'destructive',
          });
          return;
        }
        if (code === 'NOT_FOUND') {
          toast({
            title: t('skills.asset.notFound', {
              defaultValue: 'Skill not found',
            }),
            variant: 'destructive',
          });
          return;
        }
      }
      const fallback = error instanceof Error ? error.message : String(error);
      // Path-traversal / invalid path errors arrive as Error not ConvexError.
      if (
        fallback.includes('Asset path') ||
        fallback.includes('Path traversal')
      ) {
        setPathError(fallback);
        return;
      }
      console.error(error);
      toast({
        title: t('skills.asset.saveFailed', {
          defaultValue: 'Failed to save file',
        }),
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      size="wide"
      title={
        isEditMode
          ? // i18next interpolation uses the project-wide single-brace
            // prefix ({ }), not double — the prior `{{path}}` default
            // rendered the literal characters when no i18n key existed.
            t('skills.asset.editTitle', {
              defaultValue: 'Edit {path}',
              path: assetPath ?? '',
            })
          : t('skills.asset.createTitle', { defaultValue: 'New bundle file' })
      }
      // `common.save` / `common.saving` don't exist — the canonical
      // keys are `common.actions.save` / `common.actions.saving`,
      // which de/fr translate. Without this swap the dialog showed
      // raw key names in non-English locales.
      submitText={tCommon('actions.save')}
      submittingText={tCommon('actions.saving')}
      isSubmitting={isSaving}
      // Wire `isValid` to `canSave` so the Save button is actually
      // disabled during load / when the loaded asset can't be saved
      // back over (not_found, too_large). Prior shape showed an
      // enabled Save while loading then errored at submit time.
      isValid={canSave}
      isDirty={isDirty}
      confirmDiscardOnDirty
      onSubmit={() => void handleSave()}
    >
      <Stack gap={4}>
        {loadFailure === 'not_found' ? (
          <Text variant="muted" className="text-destructive">
            {t('skills.asset.loadNotFound', {
              defaultValue:
                'This file is no longer in the bundle. Close and create it from the list instead.',
            })}
          </Text>
        ) : loadFailure === 'too_large' ? (
          <Text variant="muted" className="text-destructive">
            {t('skills.asset.loadTooLarge', {
              defaultValue:
                'This file is too large to edit in the browser. Replace it from the CLI or delete it here.',
            })}
          </Text>
        ) : null}
        {!isEditMode ? (
          <>
            <Input
              id="asset-path"
              label={t('skills.asset.path', { defaultValue: 'Path' })}
              value={pathInput}
              onChange={(e) => {
                setPathInput(e.target.value);
                if (pathError) setPathError(undefined);
              }}
              onBlur={() => setPathError(validatePath(pathInput))}
              placeholder="scripts/run.py"
              errorMessage={pathError}
            />
            <Text variant="caption" className="-mt-2">
              {t('skills.asset.pathHelp', {
                defaultValue:
                  'Relative path within the skill bundle. Use scripts/ for executables, references/ for docs, assets/ for templates.',
              })}
            </Text>
          </>
        ) : (
          <Input
            id="asset-path"
            label={t('skills.asset.path', { defaultValue: 'Path' })}
            value={pathInput}
            readOnly
          />
        )}
        {loadFailure !== null ? null : (
          <Textarea
            id="asset-content"
            label={t('skills.asset.content', { defaultValue: 'Content' })}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                void handleSave();
              }
            }}
            rows={24}
            className="font-mono text-sm"
          />
        )}
      </Stack>
    </FormDialog>
  );
}
