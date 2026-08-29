import type { Sql } from 'postgres';

import { getFileUrl } from '../files/service.ts';
import type { DocumentRow } from './service.ts';

/**
 * The 0.4 `DocumentItemResponse` view — what every hub/project listing and
 * the by-id read ship to the client: display fields off the row + metadata,
 * the RAG projection joined from `app.file_metadata` (the canonical owner),
 * a presigned serve URL per backed row, creator display names, and the
 * controlled-record badge projection. Batch-computed: one metadata query,
 * one user-names query, one presign per DISTINCT blob.
 */

export interface DocumentRecordInfoView {
  state: string;
  version: number;
  hasApprovedVersions: boolean;
  currentFileId?: string;
  reviewerUserId?: string;
  reviewerName?: string;
}

export interface DocumentItemView {
  id: string;
  name: string;
  /** The current blob ref — extra vs the 0.4 item validator, carried so the
   * project Files-tab projection (its 0.4 row includes `fileId`) needs no
   * second endpoint. */
  fileId?: string;
  type: 'file' | 'folder';
  size?: number;
  mimeType?: string;
  extension?: string;
  folderId?: string;
  sourceProvider: string;
  sourceMode: 'auto' | 'manual';
  sourceCreatedAt?: number;
  sourceModifiedAt?: number;
  lastModified?: number;
  uploadedAt: number;
  syncConfigId?: string;
  isDirectlySelected?: boolean;
  url?: string;
  ragStatus?: string;
  ragIndexedAt?: number;
  ragError?: string;
  ragErrorCode?: string;
  scannedPagesDetected?: number;
  ocrApplied?: boolean;
  teamId: string | null;
  teamIds: string[];
  projectId: string | null;
  createdBy?: string;
  createdByName?: string;
  record?: DocumentRecordInfoView;
}

interface RagProjectionRow {
  storageRef: string;
  ragStatus: string | null;
  ragIndexedAt: number | null;
  ragError: string | null;
  ragErrorCode: string | null;
}

function extractExtension(fileName: string | null): string | undefined {
  if (fileName === null) return undefined;
  const match = /\.([A-Za-z0-9]{1,12})$/.exec(fileName.trim());
  return match?.[1]?.toLowerCase();
}

function recordInfo(
  row: DocumentRow,
  userNames: ReadonlyMap<string, string>,
): DocumentRecordInfoView | undefined {
  const record = row.record;
  if (record === null) return undefined;
  const state = typeof record.state === 'string' ? record.state : undefined;
  const version =
    typeof record.version === 'number' ? record.version : undefined;
  if (state === undefined || version === undefined) return undefined;
  const approved = Array.isArray(record.approvedVersions)
    ? record.approvedVersions
    : [];
  const reviewerUserId =
    typeof record.reviewerUserId === 'string' && record.reviewerUserId !== ''
      ? record.reviewerUserId
      : undefined;
  const reviewerName =
    reviewerUserId !== undefined ? userNames.get(reviewerUserId) : undefined;
  return {
    state,
    version,
    hasApprovedVersions: approved.length > 0,
    ...(row.fileRef !== null ? { currentFileId: row.fileRef } : {}),
    ...(reviewerUserId !== undefined ? { reviewerUserId } : {}),
    ...(reviewerName !== undefined ? { reviewerName } : {}),
  };
}

/** Batch-transform document rows to the 0.4 item view. */
export async function toDocumentItems(
  sql: Sql,
  organizationId: string,
  rows: readonly DocumentRow[],
): Promise<DocumentItemView[]> {
  if (rows.length === 0) return [];

  // Creator + reviewer display names in one read.
  const userIds = new Set<string>();
  for (const row of rows) {
    if (row.createdBy !== null) userIds.add(row.createdBy);
    const reviewer = row.record?.reviewerUserId;
    if (typeof reviewer === 'string' && reviewer !== '') userIds.add(reviewer);
  }
  const userNames = new Map<string, string>();
  if (userIds.size > 0) {
    const users = await sql<{ id: string; name: string | null }[]>`
      SELECT id, name FROM "user" WHERE id = ANY(${[...userIds]})
    `;
    for (const user of users) {
      if (user.name !== null) userNames.set(user.id, user.name);
    }
  }

  // RAG projection from file_metadata (canonical owner), one query.
  const refs = [
    ...new Set(
      rows
        .map((row) => row.fileRef)
        .filter((ref): ref is string => ref !== null),
    ),
  ];
  const ragByRef = new Map<string, RagProjectionRow>();
  if (refs.length > 0) {
    const metas = await sql<RagProjectionRow[]>`
      SELECT storage_ref AS "storageRef", rag_status AS "ragStatus",
             rag_indexed_at_ms::float8 AS "ragIndexedAt",
             rag_error AS "ragError", rag_error_code AS "ragErrorCode"
      FROM app.file_metadata
      WHERE org_id = ${organizationId} AND storage_ref = ANY(${refs})
    `;
    for (const meta of metas) ragByRef.set(meta.storageRef, meta);
  }

  // One presigned serve URL per DISTINCT blob (local sigv4, no network).
  const urlByRef = new Map<string, string>();
  await Promise.all(
    refs.map(async (ref) => {
      try {
        urlByRef.set(ref, await getFileUrl(sql, { organizationId }, ref));
      } catch (error) {
        // A row whose blob store is unreachable renders without a URL.
        console.warn('[documents] presign failed for', ref, error);
      }
    }),
  );

  return rows.map((row) => {
    const metadata = row.metadata ?? {};
    const metaString = (key: string): string | undefined => {
      const value = metadata[key];
      return typeof value === 'string' && value !== '' ? value : undefined;
    };
    const metaNumber = (key: string): number | undefined => {
      const value = metadata[key];
      return typeof value === 'number' ? value : undefined;
    };
    const rawMode = metaString('sourceMode');
    const sourceMode: 'auto' | 'manual' =
      rawMode === 'auto' || rawMode === 'manual'
        ? rawMode
        : rawMode === 'sync'
          ? 'auto'
          : 'manual';
    const rawType = metaString('type');
    const rag = row.fileRef !== null ? ragByRef.get(row.fileRef) : undefined;
    const lastModified =
      row.sourceModifiedAt ??
      metaNumber('sourceModifiedAt') ??
      metaNumber('lastModified');
    const createdByName =
      row.createdBy !== null ? userNames.get(row.createdBy) : undefined;
    const record = recordInfo(row, userNames);
    const isDirectlySelected = metadata.isDirectlySelected;
    const view: DocumentItemView = {
      id: row.id,
      name: row.title ?? metaString('name') ?? 'Untitled',
      ...(row.fileRef !== null ? { fileId: row.fileRef } : {}),
      type: rawType === 'folder' ? 'folder' : 'file',
      sourceProvider:
        row.sourceProvider ?? metaString('sourceProvider') ?? 'upload',
      sourceMode,
      uploadedAt: row.createdAt,
      teamId: row.teamId,
      teamIds: row.teamTags,
      projectId: row.projectId,
    };
    const size = metaNumber('size');
    if (size !== undefined) view.size = size;
    const mimeType = row.mimeType ?? metaString('mimeType');
    if (mimeType !== undefined && mimeType !== null) view.mimeType = mimeType;
    const extension =
      row.extension ?? metaString('extension') ?? extractExtension(row.title);
    if (extension !== undefined && extension !== null) {
      view.extension = extension;
    }
    if (row.folderId !== null) view.folderId = row.folderId;
    if (row.sourceCreatedAt !== null)
      view.sourceCreatedAt = row.sourceCreatedAt;
    if (row.sourceModifiedAt !== null) {
      view.sourceModifiedAt = row.sourceModifiedAt;
    }
    if (lastModified !== undefined && lastModified !== null) {
      view.lastModified = lastModified;
    }
    const syncConfigId = metaString('syncConfigId');
    if (syncConfigId !== undefined) view.syncConfigId = syncConfigId;
    if (typeof isDirectlySelected === 'boolean') {
      view.isDirectlySelected = isDirectlySelected;
    }
    const url = row.fileRef !== null ? urlByRef.get(row.fileRef) : undefined;
    if (url !== undefined) view.url = url;
    if (rag?.ragStatus != null) view.ragStatus = rag.ragStatus;
    if (rag?.ragIndexedAt != null) view.ragIndexedAt = rag.ragIndexedAt;
    if (rag?.ragError != null) view.ragError = rag.ragError;
    if (rag?.ragErrorCode != null) view.ragErrorCode = rag.ragErrorCode;
    if (row.scannedPagesDetected !== null) {
      view.scannedPagesDetected = row.scannedPagesDetected;
    }
    if (row.ocrApplied !== null) view.ocrApplied = row.ocrApplied;
    if (row.createdBy !== null) view.createdBy = row.createdBy;
    if (createdByName !== undefined) view.createdByName = createdByName;
    if (record !== undefined) view.record = record;
    return view;
  });
}
