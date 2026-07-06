/**
 * Documents Model - Index
 */

export * from './validators';
export type {
  RagStatus,
  SourceProvider,
  DocumentItemResponse,
  DocumentFindResponse,
  DocumentRecord,
  CreateDocumentArgs,
  CreateDocumentResult,
} from './types';
export * from './create_document';
export * from './get_document_by_id';
export * from './query_documents';
export * from './check_membership';
export * from './generate_signed_url';
export * from './transform_to_document_item';
export * from './get_user_names_batch';
export * from './get_documents';
export * from './get_documents_cursor';
export * from './get_document_by_id_transformed';
export * from './get_document_by_path';
export * from './update_document';
export * from './delete_document';
export * from './create_onedrive_sync_config';
export * from './get_onedrive_sync_configs';
export * from './upload_base64_to_storage';
export * from './read_file_base64_from_storage';
// NOTE: `generate_document` / `generate_docx` are intentionally NOT re-exported
// here. They are `'use node'` modules (Playwright/jszip/markdown deps), and this
// barrel is namespace-imported by the V8 `documents/internal_queries.ts`.
// Re-exporting them would pull `node:*` into the V8 bundle and break
// `bun run dev`. Node callers import them directly from their modules.
export * from './extract_extension';
export * from './find_document_by_title';
export * from './find_document_by_external_id';
export * from './find_documents_by_external_id';
export * from './find_document_by_file_id';
export * from './update_document_internal';
