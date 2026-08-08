import {
  DOCUMENT_MAX_FILE_SIZE,
  isAllowedDocumentUpload,
  resolveFileType,
  extractExtension,
} from '@/lib/shared/file-types';
import { formatNumber } from '@/lib/utils/format/number';

interface UploadPolicyLimits {
  allowedExtensions: string[];
  blockedExtensions: string[];
  documentMaxFileSize: number;
  policyEnabled: boolean;
}

export type DocumentUploadSelectionIssue =
  | { kind: 'unsupported'; fileName: string }
  | { kind: 'extensionBlocked'; fileName: string; extension: string }
  | {
      kind: 'extensionNotAllowed';
      fileName: string;
      extension: string;
      allowed: string;
    }
  | { kind: 'extensionMismatch'; expectedExtension: string }
  | { kind: 'formatMismatch' }
  | {
      kind: 'tooLarge';
      fileName: string;
      maxSizeMb: number;
      currentSizeMb: number;
    };

type Translate = (
  key: string,
  values?: Record<string, string | number>,
) => string;

export function documentUploadMaxFileSize(policy: UploadPolicyLimits): number {
  return policy.policyEnabled
    ? policy.documentMaxFileSize
    : DOCUMENT_MAX_FILE_SIZE;
}

export function documentUploadAccept(
  policy: UploadPolicyLimits,
  defaultAccept: string,
  requiredExtension?: string,
  requiredContentType?: string,
): string {
  if (requiredExtension) return `.${requiredExtension}`;
  if (requiredContentType) return requiredContentType;
  if (!policy.policyEnabled || policy.allowedExtensions.length === 0) {
    return defaultAccept;
  }
  return policy.allowedExtensions.map((ext) => `.${ext}`).join(',');
}

export function validateDocumentUploadSelection(
  file: File,
  policy: UploadPolicyLimits,
  requiredExtension?: string,
  requiredContentType?: string,
): DocumentUploadSelectionIssue | null {
  const resolved = resolveFileType(file.name, file.type);
  if (!isAllowedDocumentUpload(resolved, file.name)) {
    return { kind: 'unsupported', fileName: file.name };
  }

  const extension = extractExtension(file.name) ?? '';
  if (requiredExtension && extension !== requiredExtension) {
    return { kind: 'extensionMismatch', expectedExtension: requiredExtension };
  }
  if (
    !requiredExtension &&
    requiredContentType &&
    resolved.toLowerCase().split(';', 1)[0]?.trim() !==
      requiredContentType.toLowerCase().split(';', 1)[0]?.trim()
  ) {
    return { kind: 'formatMismatch' };
  }

  if (policy.policyEnabled) {
    if (
      policy.blockedExtensions.length > 0 &&
      policy.blockedExtensions.includes(extension)
    ) {
      return {
        kind: 'extensionBlocked',
        fileName: file.name,
        extension,
      };
    }
    if (
      policy.allowedExtensions.length > 0 &&
      !policy.allowedExtensions.includes(extension)
    ) {
      return {
        kind: 'extensionNotAllowed',
        fileName: file.name,
        extension,
        allowed: policy.allowedExtensions.join(', '),
      };
    }
  }

  const maxFileSize = documentUploadMaxFileSize(policy);
  if (file.size > maxFileSize) {
    return {
      kind: 'tooLarge',
      fileName: file.name,
      maxSizeMb: maxFileSize / (1024 * 1024),
      currentSizeMb: file.size / (1024 * 1024),
    };
  }

  return null;
}

export function documentUploadSelectionIssueMessage(
  issue: DocumentUploadSelectionIssue,
  t: Translate,
  locale?: string,
): { title: string; description: string } {
  switch (issue.kind) {
    case 'unsupported':
      return {
        title: t('upload.unsupportedFileType'),
        description: t('upload.unsupportedFileTypeDescription', {
          name: issue.fileName,
        }),
      };
    case 'extensionBlocked':
      return {
        title: t('upload.unsupportedFileType'),
        description: t('upload.extensionBlocked', {
          name: issue.fileName,
          ext: issue.extension,
        }),
      };
    case 'extensionNotAllowed':
      return {
        title: t('upload.unsupportedFileType'),
        description: t('upload.extensionNotAllowed', {
          name: issue.fileName,
          ext: issue.extension,
          allowed: issue.allowed,
        }),
      };
    case 'extensionMismatch':
      return {
        title: t('record.replace.formatTitle'),
        description: t('record.replace.extensionMismatch', {
          extension: issue.expectedExtension,
        }),
      };
    case 'formatMismatch':
      return {
        title: t('record.replace.formatTitle'),
        description: t('record.replace.formatMismatch'),
      };
    case 'tooLarge':
      return {
        title: t('upload.fileTooLarge'),
        description: t('upload.fileSizeExceeded', {
          name: issue.fileName,
          maxSize: formatNumber(issue.maxSizeMb, locale, {
            maximumFractionDigits: 1,
          }),
          currentSize: formatNumber(issue.currentSizeMb, locale, {
            maximumFractionDigits: 1,
          }),
        }),
      };
    default:
      throw new Error('Unknown document upload selection issue');
  }
}
