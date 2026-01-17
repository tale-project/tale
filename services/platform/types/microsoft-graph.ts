/**
 * Microsoft Graph API types for OneDrive integration
 */

export interface DriveItem {
  id: string;
  name: string;
  size?: number;
  createdDateTime: string;
  lastModifiedDateTime: string;
  webUrl: string;
  downloadUrl?: string;
  file?: {
    mimeType: string;
    hashes?: {
      sha1Hash?: string;
      sha256Hash?: string;
    };
  };
  folder?: {
    childCount: number;
  };
  parentReference?: {
    driveId: string;
    driveType: string;
    id: string;
    path: string;
  };
  '@microsoft.graph.downloadUrl'?: string;
}

export interface DriveItemsResponse {
  '@odata.context': string;
  '@odata.nextLink'?: string;
  value: DriveItem[];
}

export interface DriveItemContent {
  content: string | ArrayBuffer;
  mimeType: string;
  size: number;
}

export interface GraphError {
  error: {
    code: string;
    message: string;
    innerError?: {
      code: string;
      message: string;
    };
  };
}

export interface ListFilesOptions {
  folderId?: string;
  pageSize?: number;
  nextLink?: string;
  filter?: string;
  orderBy?: string;
}

export interface FileReadOptions {
  asText?: boolean;
  encoding?: string;
}

export interface EnhancedError extends Error {
  graphError: {
    status: number;
    code?: string;
    message: string;
    innerError?: {
      code: string;
      message: string;
    };
    endpoint: string;
    url: string;
    timestamp: string;
  };
}
