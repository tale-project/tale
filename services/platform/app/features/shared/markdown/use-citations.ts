export interface CitationInfo {
  number: number;
  filename?: string;
  fileId?: string;
  page?: number;
  relevance?: number;
  url?: string;
  type: 'rag' | 'web';
}
