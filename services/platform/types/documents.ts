export interface DocumentItem {
  id: string;
  name?: string;
  type: 'file' | 'folder';
  size?: number;
  storagePath?: string;
  sourceProvider?: 'onedrive' | 'upload';
  sourceMode?: 'auto' | 'manual';
  lastModified?: number;
  syncConfigId?: string;
  isDirectlySelected?: boolean;
}

export interface DocumentListResponse {
  success: boolean;
  items: DocumentItem[];
  totalItems: number;
  pagination?: {
    hasNextPage: boolean;
    currentPage: number;
    pageSize: number;
  };
  error?: string;
}

export interface UploadResult {
  success: boolean;
  fileInfo?: {
    name: string;
    storagePath: string;
    size: number;
    url?: string;
  };
  error?: string;
}
