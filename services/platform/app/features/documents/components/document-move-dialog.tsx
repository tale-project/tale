'use client';

import { Button } from '@tale/ui/button';
import { Dialog } from '@tale/ui/dialog/dialog';
import { Row, Stack } from '@tale/ui/layout';
import { Select } from '@tale/ui/select';
import { Text } from '@tale/ui/text';
import { toast } from '@tale/ui/use-toast';
import { useCallback, useMemo, useState } from 'react';

import { useT } from '@/lib/i18n/client';

import { useUpdateDocument } from '../hooks/mutations';
import { useAllHubFolders } from '../hooks/queries';

/** The value the Select carries for "no folder" — `null` on the wire. */
const ROOT_VALUE = '__root__';

interface DocumentMoveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  documentId: string;
  documentName?: string | null;
  /** Where the document sits now, so the picker opens on it and the Move
   *  button stays disabled until the choice actually changes. */
  currentFolderId?: string | null;
}

interface FolderOption {
  _id: string;
  name: string;
  parentId?: string;
}

/**
 * Full path for each folder, so two folders sharing a name stay apart in a
 * flat list. A row whose parent is missing from the list — the caller lost
 * access to an ancestor, or the tree changed under the query — keeps its own
 * name rather than disappearing.
 */
export function folderPathLabels(
  folders: readonly FolderOption[],
): Map<string, string> {
  const byId = new Map(folders.map((folder) => [folder._id, folder]));
  const labels = new Map<string, string>();
  const pathOf = (folder: FolderOption, seen: Set<string>): string => {
    const cached = labels.get(folder._id);
    if (cached !== undefined) return cached;
    const parent =
      folder.parentId === undefined ? undefined : byId.get(folder.parentId);
    // `seen` stops a cycle a corrupt parent chain would otherwise spin on.
    const label =
      parent === undefined || seen.has(parent._id)
        ? folder.name
        : `${pathOf(parent, new Set(seen).add(folder._id))} / ${folder.name}`;
    labels.set(folder._id, label);
    return label;
  };
  for (const folder of folders) pathOf(folder, new Set([folder._id]));
  return labels;
}

/**
 * Move one document to another hub folder, or back to the root.
 *
 * The destination list is every hub folder the caller can see, which is
 * already what the server will accept: it refuses a folder outside the
 * caller's teams, and a team folder re-stamps its team on what lands in it.
 */
export function DocumentMoveDialog({
  open,
  onOpenChange,
  organizationId,
  documentId,
  documentName,
  currentFolderId,
}: DocumentMoveDialogProps) {
  const { t: tDocuments } = useT('documents');
  const { t: tCommon } = useT('common');
  const { data: folders } = useAllHubFolders(organizationId);
  const updateDocument = useUpdateDocument();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selected, setSelected] = useState<string>(
    () => currentFolderId ?? ROOT_VALUE,
  );

  const options = useMemo(() => {
    const rows = folders ?? [];
    const labels = folderPathLabels(rows);
    return [
      { value: ROOT_VALUE, label: tDocuments('move.rootOption') },
      ...rows
        .map((folder) => ({
          value: folder._id,
          label: labels.get(folder._id) ?? folder.name,
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    ];
  }, [folders, tDocuments]);

  const changed = selected !== (currentFolderId ?? ROOT_VALUE);

  const handleMove = useCallback(async () => {
    setIsSubmitting(true);
    try {
      await updateDocument.mutateAsync({
        documentId,
        folderId: selected === ROOT_VALUE ? null : selected,
      });
      toast({ title: tDocuments('move.moved'), variant: 'success' });
      onOpenChange(false);
    } catch (error) {
      console.error(error);
      toast({ title: tDocuments('move.moveFailed'), variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
    }
  }, [documentId, selected, updateDocument, onOpenChange, tDocuments]);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={tDocuments('move.title')}
      size="md"
    >
      <Stack gap={4} className="pt-1">
        {documentName ? (
          <Text as="div" variant="muted">
            {tDocuments('move.description', { name: documentName })}
          </Text>
        ) : null}
        <Select
          value={selected}
          onValueChange={setSelected}
          label={tDocuments('move.destinationLabel')}
          options={options}
        />
        <Row gap={2} className="justify-end">
          <Button
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            {tCommon('actions.cancel')}
          </Button>
          <Button
            onClick={() => void handleMove()}
            disabled={!changed || isSubmitting}
          >
            {isSubmitting
              ? tDocuments('move.moving')
              : tDocuments('move.confirm')}
          </Button>
        </Row>
      </Stack>
    </Dialog>
  );
}
