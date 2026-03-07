export type DocumentListResult = {
  documents: Array<{
    id: string;
    title: string;
    extension: string | null;
    folderPath: string | null;
    teamId: string | null;
    createdAt: number;
    sizeBytes: number | null;
  }>;
  totalCount: number;
  hasMore: boolean;
  cursor: number | null;
};
