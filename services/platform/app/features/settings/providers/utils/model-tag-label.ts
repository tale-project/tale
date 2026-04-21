import type { TFunction } from 'i18next';

import type { ModelTag } from '@/lib/shared/schemas/providers';

const TAG_KEYS: Record<ModelTag, string> = {
  chat: 'providers.tagChat',
  vision: 'providers.tagVision',
  embedding: 'providers.tagEmbedding',
  'image-generation': 'providers.tagImageGeneration',
  'image-edit': 'providers.tagImageEdit',
  transcription: 'providers.tagTranscription',
};

export function modelTagLabel(tag: string, t: TFunction): string {
  const key = (TAG_KEYS as Record<string, string | undefined>)[tag];
  return key ? t(key) : tag;
}
