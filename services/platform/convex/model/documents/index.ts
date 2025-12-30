/**
 * Documents Model - Index
 *
 * Central export point for all document model functions
 */

// Export validators
export * from './validators';

// Export types
export * from './types';

// Export functions
export { createDocument } from './create_document';
export { getDocumentById } from './get_document_by_id';
export { queryDocuments } from './query_documents';
export { checkMembership } from './check_membership';
export { generateSignedUrl } from './generate_signed_url';
export { transformToDocumentItem } from './transform_to_document_item';
export { getDocuments } from './get_documents';
export { getDocumentByIdPublic } from './get_document_by_id_public';
export { getDocumentByPath } from './get_document_by_path';
export { updateDocument } from './update_document';
export { deleteDocument } from './delete_document';
export { createOneDriveSyncConfig } from './create_onedrive_sync_config';
export { getOneDriveSyncConfigs } from './get_onedrive_sync_configs';
export { uploadBase64ToStorage } from './upload_base64_to_storage';
export { readFileBase64FromStorage } from './read_file_base64_from_storage';
export { generateDocument } from './generate_document';
export { analyzePptx } from './analyze_pptx';
export { generatePptx } from './generate_pptx';
export { generateDocx } from './generate_docx';
export { generateDocxFromTemplate } from './generate_docx_from_template';
export { extractExtension } from './extract_extension';
export { listDocumentsByExtension } from './list_documents_by_extension';
export { findDocumentByTitle } from './find_document_by_title';

// Export types for PPTX/DOCX generation
export type {
  TextContentInfo,
  ChartInfo,
  TableInfo,
  ImageInfo,
  SlideInfo,
  BrandingInfo,
  AnalyzePptxArgs,
  AnalyzePptxResult,
} from './analyze_pptx';
export type {
  SlideContentData,
  PptxBrandingData,
  GeneratePptxArgs,
  GeneratePptxResult,
} from './generate_pptx';
export type {
  DocxSection,
  DocxContent,
  GenerateDocxArgs,
  GenerateDocxResult,
} from './generate_docx';

export type {
  GenerateDocxFromTemplateArgs,
  GenerateDocxFromTemplateResult,
} from './generate_docx_from_template';
