/**
 * `folders` — the wire contract for the backend calls the app makes into this
 * family: one entry per function name, carrying its argument and response
 * shapes. Materialized from the shapes the app consumed at the Convex
 * retirement, so the hook wrappers stay fully typed with no generated
 * `_generated/api` behind them; the adapter rows in `../folders.ts` are what
 * actually serve them.
 */

export interface FoldersContract {
  'folders/mutations:createFolder': {
    kind: 'mutation';
    args: {
      projectId?: string;
      teamId?: string;
      parentId?: string;
      organizationId: string;
      name: string;
    };
    returns: string;
  };
  'folders/mutations:deleteFolder': {
    kind: 'mutation';
    args: { folderId: string };
    returns: null;
  };
  'folders/mutations:updateFolderTeams': {
    kind: 'mutation';
    args: { folderId: string; teamIds: string[] };
    returns: null;
  };
  'folders/queries:getFolder': {
    kind: 'query';
    args: { organizationId: string; folderId: string };
    returns: null | {
      _id: string;
      name: string;
      teamId: undefined | string;
      parentId: undefined | string;
      organizationId: string;
      projectId: undefined | string;
    };
  };
  'folders/queries:getFolderBreadcrumb': {
    kind: 'query';
    args: { organizationId: string; folderId: string };
    returns: Array<{ _id: string; name: string }>;
  };
  'folders/queries:listFolders': {
    kind: 'query';
    args: { parentId?: string; organizationId: string };
    returns: Array<
      {
        _id: string;
        _creationTime: number;
        projectId?: string;
        createdBy?: string;
        teamId?: string;
        teamTags?: string[];
        parentId?: string;
        organizationId: string;
        name: string;
      } & { syncConfigId: undefined | string }
    >;
  };
}
