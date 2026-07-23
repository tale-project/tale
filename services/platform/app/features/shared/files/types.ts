import type { FileAttachment } from './use-convex-file-upload';

export type { FileAttachment };

export interface FilePart {
  type: 'file';
  mediaType: string;
  filename?: string;
  url: string;
}
