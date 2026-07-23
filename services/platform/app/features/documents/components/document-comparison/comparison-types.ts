/**
 * Wire shapes of the `compareDocuments` action's result. They used to be
 * imported from the comparison helper that lived with the retired AI-tool
 * backend; the action itself survived in `convex/documents/` (it currently
 * reports the comparison engine as offline while that backend is rebuilt),
 * so the UI keeps its own copy of the result contract.
 */

export interface DiffItem {
  type: 'added' | 'deleted' | 'modified' | 'context';
  baseContent: string | null;
  comparisonContent: string | null;
  content: string | null;
  inlineDiff?: string | null;
  clauseRef?: string | null;
  basePage?: number | null;
  comparisonPage?: number | null;
}

export interface ChangeBlock {
  contextBefore: string | null;
  items: DiffItem[];
  contextAfter: string | null;
}

export interface DiffStats {
  totalParagraphsBase: number;
  totalParagraphsComparison: number;
  unchanged: number;
  modified: number;
  added: number;
  deleted: number;
  highDivergence: boolean;
}

export interface DocumentInfo {
  fileId: string | null;
  title: string | null;
}

export interface DocumentComparisonResult {
  baseDocument: DocumentInfo;
  comparisonDocument: DocumentInfo;
  changeBlocks: ChangeBlock[];
  stats: DiffStats;
  truncated: boolean;
}
