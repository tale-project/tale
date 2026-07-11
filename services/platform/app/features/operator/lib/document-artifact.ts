/**
 * Detect the platform document-action create/upsert return shape so operator
 * panels can render a human summary instead of raw ids.
 */
import { asRecord, pickString } from './output-helpers';

export type DocumentArtifactAction = 'created' | 'updated' | 'skipped';

export interface DocumentArtifactResult {
  title: string;
  action: DocumentArtifactAction;
  fileId?: string;
  /** Always present when parseDocumentArtifact returns a result. */
  documentId: string;
  success?: boolean;
  contentChanged?: boolean;
}

const ACTIONS = new Set<string>(['created', 'updated', 'skipped']);

export function parseDocumentArtifact(
  data: unknown,
): DocumentArtifactResult | undefined {
  const out = asRecord(data);
  if (!out) return undefined;
  const title = pickString(out, 'title');
  const action = pickString(out, 'action');
  const documentId = pickString(out, 'documentId');
  if (title === undefined || action === undefined || documentId === undefined) {
    return undefined;
  }
  if (!ACTIONS.has(action)) return undefined;
  const result: DocumentArtifactResult = {
    title,
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- guarded by ACTIONS
    action: action as DocumentArtifactAction,
    documentId,
  };
  const fileId = pickString(out, 'fileId');
  if (fileId !== undefined) result.fileId = fileId;
  if (typeof out.success === 'boolean') result.success = out.success;
  if (typeof out.contentChanged === 'boolean') {
    result.contentChanged = out.contentChanged;
  }
  return result;
}
