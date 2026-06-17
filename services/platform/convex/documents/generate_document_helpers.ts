import type { DocumentOutputFormat } from './types';

/**
 * Get content type and file extension based on output format.
 */
export function getOutputInfo(
  outputFormat: DocumentOutputFormat,
  imageType?: string,
): { contentType: string; extension: string } {
  if (outputFormat === 'pdf') {
    return { contentType: 'application/pdf', extension: 'pdf' };
  }
  if (outputFormat === 'docx') {
    return {
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      extension: 'docx',
    };
  }
  if (outputFormat === 'pptx') {
    return {
      contentType:
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      extension: 'pptx',
    };
  }
  const type = imageType ?? 'png';
  return {
    contentType: type === 'png' ? 'image/png' : 'image/jpeg',
    extension: type,
  };
}

export { buildDownloadUrl } from '../lib/helpers/public_storage_url';
