import { useMemo } from 'react';

import {
  CHAT_MAX_FILE_SIZE,
  CHAT_UPLOAD_ALLOWED_TYPES,
  DOCUMENT_MAX_FILE_SIZE,
} from '@/lib/shared/file-types';
import {
  uploadPolicyConfigSchema,
  type UploadPolicyConfig,
} from '@/lib/shared/schemas/governance';
import { isRecord } from '@/lib/utils/type-guards';

import { useGovernancePolicy } from './queries';

interface UploadPolicyLimits {
  maxFileSize: number;
  allowedTypes: string[];
  allowedExtensions: string[];
  blockedExtensions: string[];
  documentMaxFileSize: number;
  policyEnabled: boolean;
}

function parseUploadPolicyConfig(
  rawConfig: unknown,
): UploadPolicyConfig | null {
  const config = isRecord(rawConfig) ? rawConfig : {};
  const result = uploadPolicyConfigSchema.safeParse(config);
  if (result.success) {
    return result.data;
  }
  return null;
}

export function useUploadPolicy(organizationId: string): UploadPolicyLimits {
  const { data: policy } = useGovernancePolicy(organizationId, 'upload_policy');

  return useMemo(() => {
    const config = policy ? parseUploadPolicyConfig(policy.config) : null;

    if (!config || !config.enabled) {
      return {
        maxFileSize: CHAT_MAX_FILE_SIZE,
        allowedTypes: [...CHAT_UPLOAD_ALLOWED_TYPES],
        allowedExtensions: [],
        blockedExtensions: [],
        documentMaxFileSize: DOCUMENT_MAX_FILE_SIZE,
        policyEnabled: false,
      };
    }

    return {
      maxFileSize: config.maxFileSizeBytes ?? CHAT_MAX_FILE_SIZE,
      allowedTypes:
        config.allowedMimeTypes && config.allowedMimeTypes.length > 0
          ? config.allowedMimeTypes
          : [...CHAT_UPLOAD_ALLOWED_TYPES],
      allowedExtensions: (config.allowedExtensions ?? []).map((e) =>
        e.toLowerCase().replace(/^\./, ''),
      ),
      blockedExtensions: (config.blockedExtensions ?? []).map((e) =>
        e.toLowerCase().replace(/^\./, ''),
      ),
      documentMaxFileSize: config.maxFileSizeBytes ?? DOCUMENT_MAX_FILE_SIZE,
      policyEnabled: true,
    };
  }, [policy]);
}
