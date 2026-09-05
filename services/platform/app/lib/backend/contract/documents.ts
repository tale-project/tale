/**
 * `documents` — the wire contract for the backend calls the app makes into this
 * family: one entry per function name, carrying its argument and response
 * shapes. Materialized from the shapes the app consumed at the Convex
 * retirement, so the hook wrappers stay fully typed with no generated
 * `_generated/api` behind them; the adapter rows in `../documents.ts` are what
 * actually serve them.
 */

export interface DocumentsContract {
  'documents/actions:retryRagIndexing': {
    kind: 'action';
    args: { documentId: string };
    returns: { success: boolean; error?: string };
  };
  'documents/compare_documents:compareDocuments': {
    kind: 'action';
    args: {
      organizationId: string;
      baseStorageId: string;
      baseFileName: string;
      comparisonStorageId: string;
      comparisonFileName: string;
    };
    returns: never;
  };
  'documents/mutations:createDocumentFromUpload': {
    kind: 'mutation';
    args: {
      metadata?: Record<string, unknown>;
      projectId?: string;
      fileSize?: number;
      teamId?: string;
      contentHash?: string;
      folderId?: string;
      contentType?: string;
      skipRagIndexing?: boolean;
      organizationId: string;
      fileId: string;
      fileName: string;
    };
    returns: { success: boolean; documentId: string };
  };
  'documents/mutations:deleteDocument': {
    kind: 'mutation';
    args: { documentId: string };
    returns: null;
  };
  'documents/mutations:updateDocument': {
    kind: 'mutation';
    args: {
      metadata?: Record<string, unknown>;
      title?: string;
      fileId?: string;
      content?: string;
      mimeType?: string;
      extension?: string;
      sourceProvider?: string;
      externalItemId?: string;
      teamIds?: string[];
      documentId: string;
    };
    returns: null;
  };
  'documents/public_actions:ensureProjectTextDocument': {
    kind: 'action';
    args: {
      content?: string;
      externalItemId?: string;
      contentType?: string;
      yaml?: Record<string, string>;
      seedSkillFiles?: Array<{
        externalItemId?: string;
        fileName: string;
        skillSlug: string;
        skillPath: string;
      }>;
      organizationId: string;
      projectId: string;
      fileName: string;
      folderName: string;
    };
    returns: {
      folderId: string;
      documentId: string;
      createdFolder: boolean;
      action: 'skipped' | 'created' | 'updated';
      seededSkillFiles?: number;
    };
  };
  'documents/public_actions:readProjectTextValues': {
    kind: 'action';
    args: {
      organizationId: string;
      projectId: string;
      fileName: string;
      folderName: string;
    };
    returns: Record<string, string>;
  };
  'documents/queries:approxCountDocuments': {
    kind: 'query';
    args: { organizationId: string };
    returns: number;
  };
  'documents/queries:getDocumentByExternalItemId': {
    kind: 'query';
    args: {
      projectId?: string;
      organizationId: string;
      externalItemId: string;
    };
    returns: null | {
      documentId: string;
      title: undefined | string;
      folderId: undefined | string;
      hasHistory: boolean;
    };
  };
  'documents/queries:getDocumentById': {
    kind: 'query';
    args: { organizationId: string; documentId: string };
    returns: null | {
      record?: {
        reviewerUserId?: string;
        currentFileId?: string;
        reviewerName?: string;
        hasApprovedVersions?: boolean;
        version: number;
        state: 'approved' | 'draft' | 'in_review';
      };
      name?: string;
      projectId?: null | string;
      createdBy?: string;
      teamId?: null | string;
      mimeType?: string;
      extension?: string;
      sourceProvider?: string;
      scannedPagesDetected?: number;
      ocrApplied?: boolean;
      sourceCreatedAt?: number;
      sourceModifiedAt?: number;
      folderId?: string;
      size?: number;
      lastModified?: number;
      ragStatus?:
        | 'queued'
        | 'running'
        | 'failed'
        | 'completed'
        | 'unsupported'
        | 'stale'
        | 'not_indexed';
      ragError?: string;
      ragErrorCode?: string;
      ragIndexedAt?: number;
      url?: string;
      sourceMode?: 'auto' | 'manual';
      uploadedAt?: number;
      syncConfigId?: string;
      isDirectlySelected?: boolean;
      teamIds?: string[];
      createdByName?: string;
      id: string;
      type: 'file' | 'folder';
    };
  };
  'documents/queries:getUploadUsage': {
    kind: 'query';
    args: { organizationId: string };
    returns: { limited: boolean; usedBytes: number; limitBytes: null | number };
  };
  'documents/queries:listDocumentVersions': {
    kind: 'query';
    args: { organizationId: string; documentId: string };
    returns: null | {
      documentId: string;
      title: undefined | string;
      versions: Array<{
        storageId: string;
        createdAt: number;
        isCurrent: boolean;
        fileName?: string;
        size?: number;
        contentType?: string;
      }>;
    };
  };
  'documents/queries:listDocuments': {
    kind: 'query';
    args: { organizationId: string };
    returns: {
      documents: Array<{
        record?: {
          reviewerUserId?: string;
          currentFileId?: string;
          reviewerName?: string;
          hasApprovedVersions?: boolean;
          version: number;
          state: 'approved' | 'draft' | 'in_review';
        };
        name?: string;
        projectId?: null | string;
        createdBy?: string;
        teamId?: null | string;
        mimeType?: string;
        extension?: string;
        sourceProvider?: string;
        scannedPagesDetected?: number;
        ocrApplied?: boolean;
        sourceCreatedAt?: number;
        sourceModifiedAt?: number;
        folderId?: string;
        size?: number;
        lastModified?: number;
        ragStatus?:
          | 'queued'
          | 'running'
          | 'failed'
          | 'completed'
          | 'unsupported'
          | 'stale'
          | 'not_indexed';
        ragError?: string;
        ragErrorCode?: string;
        ragIndexedAt?: number;
        url?: string;
        sourceMode?: 'auto' | 'manual';
        uploadedAt?: number;
        syncConfigId?: string;
        isDirectlySelected?: boolean;
        teamIds?: string[];
        createdByName?: string;
        id: string;
        type: 'file' | 'folder';
      }>;
      truncated: boolean;
    };
  };
  'documents/queries:listDocumentsPaginated': {
    kind: 'query';
    args: {
      extension?: string;
      sourceProvider?: string;
      folderId?: string;
      organizationId: string;
      paginationOpts: {
        id?: number;
        endCursor?: null | string;
        maximumRowsRead?: number;
        maximumBytesRead?: number;
        numItems: number;
        cursor: null | string;
      };
    };
    returns: {
      page: Array<{
        record?: {
          reviewerUserId?: string;
          currentFileId?: string;
          reviewerName?: string;
          hasApprovedVersions?: boolean;
          version: number;
          state: 'approved' | 'draft' | 'in_review';
        };
        name?: string;
        projectId?: null | string;
        createdBy?: string;
        teamId?: null | string;
        mimeType?: string;
        extension?: string;
        sourceProvider?: string;
        scannedPagesDetected?: number;
        ocrApplied?: boolean;
        sourceCreatedAt?: number;
        sourceModifiedAt?: number;
        folderId?: string;
        size?: number;
        lastModified?: number;
        ragStatus?:
          | 'queued'
          | 'running'
          | 'failed'
          | 'completed'
          | 'unsupported'
          | 'stale'
          | 'not_indexed';
        ragError?: string;
        ragErrorCode?: string;
        ragIndexedAt?: number;
        url?: string;
        sourceMode?: 'auto' | 'manual';
        uploadedAt?: number;
        syncConfigId?: string;
        isDirectlySelected?: boolean;
        teamIds?: string[];
        createdByName?: string;
        id: string;
        type: 'file' | 'folder';
      }>;
      isDone: boolean;
      continueCursor: string;
    };
  };
  'documents/record_actions:beginControlledDocumentReplacementUpload': {
    kind: 'action';
    args: {
      lastModified?: number;
      contentType?: string;
      organizationId: string;
      fileName: string;
      expectedFileId: string;
      documentId: string;
      expectedRecordState: 'approved' | 'draft';
      expectedVersion: number;
    };
    returns: {
      intentId: string;
      url: string;
      method: 'POST' | 'PUT';
      uploadContentType: string;
      uploadExpiresAt: number;
    };
  };
  'documents/record_actions:finalizeControlledDocumentReplacementUpload': {
    kind: 'action';
    args: { storageId?: string; organizationId: string; intentId: string };
    returns: { version: number };
  };
  'documents/record_actions:reconcileControlledDocumentReplacementUpload': {
    kind: 'action';
    args: { organizationId: string; intentId: string };
    returns: {
      state:
        | 'failed'
        | 'cancelled'
        | 'issued'
        | 'attesting'
        | 'promoted'
        | 'bound'
        | 'superseded'
        | 'cleaned';
      resultVersion?: number;
      cleanupPending: boolean;
      lastError?: string;
      updatedAt: number;
    };
  };
  'documents/records:getLastDocumentRecordReview': {
    kind: 'query';
    args: { documentId: string };
    returns: null | {
      decision: 'approve' | 'request_changes';
      feedback?: string;
      respondedBy: string;
      respondedByName?: string;
      respondedAt: number;
      version: number;
    };
  };
  'documents/records:getPendingDocumentRecordReview': {
    kind: 'query';
    args: { documentId: string };
    returns: null | {
      approvalId: string;
      version: number;
      requestedFor: null | string;
      requestedBy: null | string;
      requestedAt: number;
    };
  };
  'documents/records:listEligibleDocumentReviewerIds': {
    kind: 'query';
    args: { documentId: string };
    returns: string[];
  };
  'documents/records:markControlled': {
    kind: 'mutation';
    args: { documentId: string };
    returns: null;
  };
  'documents/records:openRecordRevision': {
    kind: 'mutation';
    args: { documentId: string };
    returns: { version: number };
  };
  'documents/records:respondToDocumentRecordReview': {
    kind: 'mutation';
    args: {
      feedback?: string;
      decision: 'approve' | 'request_changes';
      approvalId: string;
    };
    returns: { state: 'approved' | 'draft'; version: number };
  };
  'documents/records:submitRecordForReview': {
    kind: 'mutation';
    args: { reviewerUserId: string; documentId: string };
    returns: { approvalId: string };
  };
  'documents/replacement_uploads:cancelControlledDocumentReplacementUpload': {
    kind: 'mutation';
    args: { organizationId: string; intentId: string };
    returns:
      | { state: 'bound'; resultVersion: undefined | number }
      | { state: 'cancelled'; resultVersion?: undefined };
  };
  'documents/replacement_uploads:registerControlledDocumentReplacementUpload': {
    kind: 'mutation';
    args: { organizationId: string; storageId: string; intentId: string };
    returns: null;
  };
  'documents/search:searchDocuments': {
    kind: 'query';
    args: { organizationId: string; query: string };
    returns: Array<{
      documentId: string;
      title: string;
      snippet: string;
      folderId?: string;
      projectId?: string;
      updatedAt: number;
    }>;
  };
}
