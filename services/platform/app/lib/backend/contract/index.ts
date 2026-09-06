/**
 * THE app↔backend wire contract: every function name the app calls, with its
 * argument and response shapes. The hook wrappers (`useBackendQuery`,
 * `useBackendMutation`, `useBackendAction`, `useActionQuery`) index this to type
 * a call site from its name alone, and the adapter registry
 * (`../adapters.ts`) is keyed by the SAME names — so a row and its
 * types cannot drift apart in the type system's view.
 *
 * One file per family; this index merges them into `BackendContract` and
 * derives the per-kind name unions the wrappers accept.
 */

import type { AgentSecretsContract } from './agent-secrets';
import type { AgentsContract } from './agents';
import type { ApprovalsContract } from './approvals';
import type { AuditLogsContract } from './audit-logs';
import type { AutomationsContract } from './automations';
import type { AutomationsBuilderContract } from './automations-builder';
import type { BrandingContract } from './branding';
import type { ChangelogContract } from './changelog';
import type { ChatContract } from './chat';
import type { ChatFilterEventsContract } from './chat-filter-events';
import type { CloudImportContract } from './cloud-import';
import type { CollabContract } from './collab';
import type { ConnectorCredentialsContract } from './connector-credentials';
import type { ContactsContract } from './contacts';
import type { ConversationsContract } from './conversations';
import type { DocumentsContract } from './documents';
import type { EnterpriseSsoContract } from './enterprise-sso';
import type { FeedbackContract } from './feedback';
import type { FileMetadataContract } from './file-metadata';
import type { FilesContract } from './files';
import type { FoldersContract } from './folders';
import type { GoogleDriveContract } from './google-drive';
import type { GovernanceContract } from './governance';
import type { KnowledgeContract } from './knowledge';
import type { KnowledgeEntriesContract } from './knowledge-entries';
import type { LibContract } from './lib';
import type { LoginAttemptsContract } from './login-attempts';
import type { MembersContract } from './members';
import type { NodeOnlyContract } from './node-only';
import type { NotificationsContract } from './notifications';
import type { ObjectStorageContract } from './object-storage';
import type { OnedriveContract } from './onedrive';
import type { OrganizationsContract } from './organizations';
import type { ProductsContract } from './products';
import type { ProjectsContract } from './projects';
import type { ProviderCredentialsContract } from './provider-credentials';
import type { SandboxContract } from './sandbox';
import type { ScimContract } from './scim';
import type { SkillsContract } from './skills';
import type { TasksContract } from './tasks';
import type { TeamMembersContract } from './team-members';
import type { TtsContract } from './tts';
import type { TwoFactorContract } from './two-factor';
import type { UserPreferencesContract } from './user-preferences';
import type { UsersContract } from './users';
import type { VideoLinksContract } from './video-links';
import type { WebdavContract } from './webdav';
import type { WebsitesContract } from './websites';

export interface BackendContract
  extends
    AgentSecretsContract,
    AgentsContract,
    ApprovalsContract,
    AuditLogsContract,
    AutomationsContract,
    AutomationsBuilderContract,
    BrandingContract,
    ChangelogContract,
    ChatContract,
    ChatFilterEventsContract,
    CloudImportContract,
    CollabContract,
    ConnectorCredentialsContract,
    ContactsContract,
    ConversationsContract,
    DocumentsContract,
    EnterpriseSsoContract,
    FeedbackContract,
    FileMetadataContract,
    FilesContract,
    FoldersContract,
    GoogleDriveContract,
    GovernanceContract,
    KnowledgeContract,
    KnowledgeEntriesContract,
    LibContract,
    LoginAttemptsContract,
    MembersContract,
    NodeOnlyContract,
    NotificationsContract,
    ObjectStorageContract,
    OnedriveContract,
    OrganizationsContract,
    ProductsContract,
    ProjectsContract,
    ProviderCredentialsContract,
    SandboxContract,
    ScimContract,
    SkillsContract,
    TasksContract,
    TeamMembersContract,
    TtsContract,
    TwoFactorContract,
    UserPreferencesContract,
    UsersContract,
    VideoLinksContract,
    WebdavContract,
    WebsitesContract {}

/** Every function name in the contract. */
export type BackendName = keyof BackendContract;

/** The names of one kind (query / mutation / action). */
export type NamesOfKind<Kind extends string> = {
  [K in BackendName]: BackendContract[K]['kind'] extends Kind ? K : never;
}[BackendName];

export type QueryName = NamesOfKind<'query'>;
export type MutationName = NamesOfKind<'mutation'>;
export type ActionName = NamesOfKind<'action'>;

/** The argument object a name takes. */
export type ArgsOf<K extends BackendName> = BackendContract[K]['args'];
/** What a name answers with. */
export type ReturnsOf<K extends BackendName> = BackendContract[K]['returns'];
/** One element of a listing response — the `ItemOf` replacement. */
export type ItemOf<K extends BackendName> =
  ReturnsOf<K> extends readonly (infer T)[] ? T : never;

/** The names whose response is a PAGE envelope (`{ page, isDone,
 *  continueCursor }`) — the listings the infinite-query lane serves. */
export type PaginatedName = {
  [K in QueryName]: ReturnsOf<K> extends { page: readonly unknown[] }
    ? K
    : never;
}[QueryName];

/** One row of a paginated listing's page. */
export type PageItemOf<K extends PaginatedName> =
  ReturnsOf<K> extends { page: ReadonlyArray<infer Item> } ? Item : never;
