/**
 * The names the reused 0.4 handlers address each other by.
 *
 * `internal.a.b.c` is a proxy walk that records a path; the 0.5 ctx shim
 * (`backend/lib/ctx-shim.ts`) turns that path into `a/b:c` and dispatches
 * it to a SQL-backed handler. A name with no handler throws, loudly and by
 * name, at the call — never silently.
 *
 * Every name is typed alike — kind included — because the shim keeps ONE
 * handler table and dispatches on the name alone; a query/mutation/action
 * distinction here would be precision the runtime does not have. Every node
 * is both a reference and a container, because a segment can be a module path
 * to one caller and an export to another.
 *
 * HAND-MAINTAINED. Add a line when a reused handler starts naming a new
 * function, and give the shim a handler for it in the SAME change — an entry
 * without one is a runtime refusal waiting to happen.
 */

import {
  createComponentRefs,
  createFunctionRefs,
  type FunctionRef,
} from '../../../lib/shared/handlers/function-refs';

interface HandlerNames {
  agent_secrets: FunctionRef & {
    actions: FunctionRef & {
      resolveAgentSecretsEnv: FunctionRef;
    };
  };
  anthropic: FunctionRef & {
    com: FunctionRef;
  };
  approvals: FunctionRef & {
    gate: FunctionRef & {
      evaluateApprovalGate: FunctionRef;
    };
  };
  audit_logs: FunctionRef & {
    internal_mutations: FunctionRef & {
      createAuditLog: FunctionRef;
    };
  };
  automations: FunctionRef & {
    agent_host: FunctionRef & {
      driveWorkflowAgentTurn: FunctionRef;
      startWorkflowAgentTurn: FunctionRef;
    };
    human_asks: FunctionRef & {
      closeAsk: FunctionRef;
      createAskForExec: FunctionRef;
      getAskForResume: FunctionRef;
      getPendingAskForExec: FunctionRef;
      listAnsweredAsksForNode: FunctionRef;
      recordAskParked: FunctionRef;
      retargetAgentCursor: FunctionRef;
    };
    mutations: FunctionRef & {
      claimRun: FunctionRef;
      continueRun: FunctionRef;
      finishRun: FunctionRef;
      heartbeatRun: FunctionRef;
      recordAgentTurnSettled: FunctionRef;
      recordProgress: FunctionRef;
      stampAgentTurnLaunch: FunctionRef;
      storeCancelRun: FunctionRef;
      storeDeleteTrigger: FunctionRef;
      storeDeploy: FunctionRef;
      storeRecordRun: FunctionRef;
      storeSave: FunctionRef;
      storeSetTrigger: FunctionRef;
      storeStartRun: FunctionRef;
      suspendRun: FunctionRef;
    };
    queries: FunctionRef & {
      getRunProjectContext: FunctionRef;
      getRunProjectId: FunctionRef;
      loadAutomationDocument: FunctionRef;
      loadLiveAgentOpForRun: FunctionRef;
      loadRunForStep: FunctionRef;
      readAgentCursor: FunctionRef;
      storeDeployedVersion: FunctionRef;
      storeGet: FunctionRef;
      storeGetRun: FunctionRef;
      storeList: FunctionRef;
      storeListRuns: FunctionRef;
      storeListTriggers: FunctionRef;
      storeListVersions: FunctionRef;
    };
  };
  automations_builder: FunctionRef & {
    run_session: FunctionRef & {
      dispatchEngineMethod: FunctionRef;
    };
  };
  browser_sessions: FunctionRef & {
    sessions: FunctionRef & {
      claimBrowserSession: FunctionRef;
      reportBrowserSessionResult: FunctionRef;
    };
  };
  chat: FunctionRef & {
    branches: FunctionRef & {
      getThreadLineageIds: FunctionRef;
    };
    capabilities_action: FunctionRef & {
      dispatchCapabilityAs: FunctionRef;
    };
    generations: FunctionRef & {
      endGenerationInternal: FunctionRef;
      streamProgressInternal: FunctionRef;
    };
    messages: FunctionRef & {
      appendMessageInternal: FunctionRef;
      finalizeAssistantMessageInternal: FunctionRef;
      listRecentForTurnInternal: FunctionRef;
      updateAssistantPartsInternal: FunctionRef;
    };
    threads: FunctionRef & {
      setThreadTitleInternal: FunctionRef;
    };
    turn_setup: FunctionRef & {
      beginTurnInternal: FunctionRef;
    };
  };
  connector_credentials: FunctionRef & {
    mutations: FunctionRef & {
      patchCredentialInternal: FunctionRef;
    };
    queries: FunctionRef & {
      listActiveCredentialsInternal: FunctionRef;
      listCredentials: FunctionRef;
      resolveCredentialRefInternal: FunctionRef;
    };
  };
  connectors: FunctionRef & {
    execute_action: FunctionRef & {
      runConnectorAction: FunctionRef;
    };
  };
  contacts: FunctionRef & {
    internal_mutations: FunctionRef & {
      findOrCreateContact: FunctionRef;
    };
    internal_queries: FunctionRef & {
      queryContacts: FunctionRef;
    };
  };
  conversations: FunctionRef & {
    internal_mutations: FunctionRef & {
      addMessageToConversation: FunctionRef;
      createConversationWithMessage: FunctionRef;
      updateConversationMessage: FunctionRef;
    };
    internal_queries: FunctionRef & {
      getConversationByExternalMessageId: FunctionRef;
      getConversationById: FunctionRef;
      getMessageByExternalId: FunctionRef;
      queryLatestMessageByDeliveryState: FunctionRef;
    };
    search_for_chat: FunctionRef & {
      searchConversationsForChat: FunctionRef;
    };
  };
  deepseek: FunctionRef & {
    com: FunctionRef;
  };
  documents: FunctionRef & {
    internal_actions: FunctionRef & {
      storeRawContent: FunctionRef;
    };
    internal_mutations: FunctionRef & {
      upsertDocumentByExternalId: FunctionRef;
    };
    internal_queries: FunctionRef & {
      filterRetrievableRagFileIds: FunctionRef;
      findDocumentByFileId: FunctionRef;
      listDocumentsForScope: FunctionRef;
      listFilesByFolderInternal: FunctionRef;
      listForAgent: FunctionRef;
      resolveKnowledgeAccess: FunctionRef;
    };
  };
  enterprise_sso: FunctionRef & {
    config: FunctionRef & {
      file_actions: FunctionRef & {
        getConnectionSecrets: FunctionRef;
      };
    };
    internal_actions: FunctionRef & {
      handleSsoLogin: FunctionRef;
    };
    internal_queries: FunctionRef & {
      resolveSamlConfig: FunctionRef;
      resolveSignInConfig: FunctionRef;
    };
    saml: FunctionRef & {
      validate_assertion: FunctionRef & {
        buildSamlAuthnRedirect: FunctionRef;
        validateSamlResponse: FunctionRef;
      };
    };
  };
  example: FunctionRef & {
    com: FunctionRef;
    test: FunctionRef;
  };
  file_metadata: FunctionRef & {
    internal_mutations: FunctionRef & {
      acquireTranscriptionLock: FunctionRef;
      bindFileToConversation: FunctionRef;
      bindStorageIdsToThread: FunctionRef;
      linkDocumentToFile: FunctionRef;
      releaseTranscriptionLock: FunctionRef;
      saveFileMetadata: FunctionRef;
      updateFileTranscription: FunctionRef;
    };
    internal_queries: FunctionRef & {
      filterStorageIdsReadable: FunctionRef;
      findCachedTranscript: FunctionRef;
      getByStorageId: FunctionRef;
      getStorageSha256: FunctionRef;
      listMailAttachmentsForChat: FunctionRef;
      lookupVideoLinkSources: FunctionRef;
    };
    mutations: FunctionRef;
    transcribe_audio: FunctionRef & {
      transcribeAudio: FunctionRef;
    };
  };
  files: FunctionRef & {
    blob_actions: FunctionRef & {
      deleteOrgBlobs: FunctionRef;
      storeOrgBlob: FunctionRef;
    };
  };
  fireworks: FunctionRef & {
    ai: FunctionRef;
  };
  github: FunctionRef & {
    com: FunctionRef;
  };
  governance: FunctionRef & {
    internal_mutations: FunctionRef & {
      incrementUsageLedger: FunctionRef;
      recordConnectorUsage: FunctionRef;
      recordTranscriptionUsage: FunctionRef;
    };
    internal_queries: FunctionRef & {
      getPolicyConfigInternal: FunctionRef;
      resolveModelGovernanceInternal: FunctionRef;
    };
    queries: FunctionRef & {
      checkModelAccessInternal: FunctionRef;
      getContextCapInternal: FunctionRef;
    };
  };
  knowledge: FunctionRef & {
    crawl_action: FunctionRef & {
      scanWebsite: FunctionRef;
    };
    crawl_ops: FunctionRef & {
      deregisterDomainOp: FunctionRef;
      homepageMetadataOp: FunctionRef;
      registerDomainOp: FunctionRef;
      registerUrlListOp: FunctionRef;
      setScanIntervalOp: FunctionRef;
      websiteInfoOp: FunctionRef;
    };
  };
  knowledge_entries: FunctionRef & {
    internal_queries: FunctionRef & {
      listEntriesForAgent: FunctionRef;
    };
  };
  legacy: FunctionRef & {
    knowledge_delete: FunctionRef & {
      deleteDocument: FunctionRef;
    };
  };
  lib: FunctionRef & {
    config_store: FunctionRef & {
      actions: FunctionRef & {
        readConfigArea: FunctionRef;
      };
    };
  };
  login_attempts: FunctionRef & {
    internal_queries: FunctionRef & {
      getTrustedProxies: FunctionRef;
    };
  };
  members: FunctionRef & {
    internal_queries: FunctionRef & {
      getMemberRole: FunctionRef;
    };
  };
  notifications: FunctionRef & {
    dispatch_notification: FunctionRef & {
      dispatchNotificationAction: FunctionRef;
    };
    email_notification: FunctionRef & {
      deliverActionableEmailAction: FunctionRef;
    };
  };
  openai: FunctionRef & {
    com: FunctionRef;
    example: FunctionRef;
  };
  products: FunctionRef & {
    internal_queries: FunctionRef & {
      queryProducts: FunctionRef;
    };
  };
  projects: FunctionRef & {
    internal_queries: FunctionRef & {
      assertProjectAccessForChat: FunctionRef;
      getProjectAgentSkillScope: FunctionRef;
      getProjectForInjection: FunctionRef;
      getProjectIdForThread: FunctionRef;
      getProjectLabelsForOrg: FunctionRef;
      getProjectSkillScope: FunctionRef;
    };
  };
  provider_credentials: FunctionRef & {
    queries: FunctionRef & {
      getCredentialInternal: FunctionRef;
      getDefaultCredentialInternal: FunctionRef;
      listActiveCredentialFactsInternal: FunctionRef;
    };
  };
  sandbox: FunctionRef & {
    session_mutations: FunctionRef & {
      bumpSessionOpHeartbeat: FunctionRef;
      claimSessionOpFinalize: FunctionRef;
      hibernateAutomationScopedSession: FunctionRef;
      insertSessionToken: FunctionRef;
      markSessionRowDestroyed: FunctionRef;
      markSessionTokenRevokedByKeyId: FunctionRef;
      recordCredentialAccess: FunctionRef;
      recordSessionOpSpend: FunctionRef;
      recordToolCall: FunctionRef;
      releaseProjectAgentSessionSlot: FunctionRef;
      reserveSessionSlotAndInsert: FunctionRef;
      resumeSessionSlotWithCapCheck: FunctionRef;
      setSessionStatus: FunctionRef;
      upsertSessionOp: FunctionRef;
    };
    session_queries: FunctionRef & {
      getActiveSessionByOwner: FunctionRef;
      getExternalTurnOpForFinalize: FunctionRef;
      getOpSteerState: FunctionRef;
      getSessionOwnerIdentity: FunctionRef;
    };
    workspace_access: FunctionRef & {
      resolveKnowledgeToolAccess: FunctionRef;
      resolveSessionActionContext: FunctionRef;
      resolveWorkspaceReadAccess: FunctionRef;
    };
  };
  scim: FunctionRef & {
    internal_mutations: FunctionRef & {
      deleteGroup: FunctionRef;
      deprovisionUser: FunctionRef;
      patchGroup: FunctionRef;
      patchUser: FunctionRef;
      provisionGroup: FunctionRef;
      provisionUser: FunctionRef;
      replaceGroup: FunctionRef;
      touchConfigLastUsed: FunctionRef;
    };
    internal_queries: FunctionRef & {
      findGroupRecordByDisplayName: FunctionRef;
      findUserRecordByUserName: FunctionRef;
      getConfigByTokenHash: FunctionRef;
      getGroupRecord: FunctionRef;
      getUserRecord: FunctionRef;
      listGroupRecords: FunctionRef;
      listUserRecords: FunctionRef;
    };
  };
  skills: FunctionRef & {
    file_actions: FunctionRef & {
      readSkillBundle: FunctionRef;
    };
    upload_mutations: FunctionRef & {
      deleteSkillUploadIntent: FunctionRef;
    };
  };
  tasks: FunctionRef & {
    agent_run_host: FunctionRef & {
      driveTaskAgentTurn: FunctionRef;
      steerTaskAgentTurn: FunctionRef;
    };
    agent_runs: FunctionRef & {
      getTaskAgentRunForDrive: FunctionRef;
      getTaskBriefForAgentRun: FunctionRef;
      markTaskAgentRunFailed: FunctionRef;
      markTaskAgentRunSettled: FunctionRef;
      parkTaskAgentRunForCapacity: FunctionRef;
      rotateTaskAgentRunExec: FunctionRef;
      setTaskAgentRunRunning: FunctionRef;
      stampTaskAgentRunBrokerToken: FunctionRef;
    };
    internal_mutations: FunctionRef & {
      agentAddComment: FunctionRef;
      agentCreateTask: FunctionRef;
      agentRecordTaskOutputs: FunctionRef;
      agentUpdateTaskStatus: FunctionRef;
      agentUpsertTaskByExternalRef: FunctionRef;
    };
    internal_queries: FunctionRef & {
      getTaskByIdInternal: FunctionRef;
      getTaskContextForAgent: FunctionRef;
      listTasksForAgent: FunctionRef;
    };
    mutations: FunctionRef & {
      kickMentionRunAfterSteerMiss: FunctionRef;
    };
    search_for_chat: FunctionRef & {
      searchProjectsForChat: FunctionRef;
      searchTasksForChat: FunctionRef;
    };
  };
  two_factor: FunctionRef & {
    internal_mutations: FunctionRef & {
      clearOnSuccess: FunctionRef;
      logEnrollmentEvent: FunctionRef;
      recordFailure: FunctionRef;
      setGraceUntilIfAbsent: FunctionRef;
    };
    internal_queries: FunctionRef & {
      evaluateEnforcement: FunctionRef;
      getLockStateByUserId: FunctionRef;
    };
  };
  user_preferences: FunctionRef & {
    queries: FunctionRef & {
      getChatModelInternal: FunctionRef;
    };
  };
  video_links: FunctionRef & {
    ingest_video_link: FunctionRef & {
      ingestVideoLink: FunctionRef;
    };
    internal_mutations: FunctionRef & {
      cleanupCancelledVideoLink: FunctionRef;
      heartbeatJobByStorageId: FunctionRef;
      insertSyntheticFileMetadata: FunctionRef;
      updateJob: FunctionRef;
    };
    internal_queries: FunctionRef & {
      getJobById: FunctionRef;
    };
  };
  websites: FunctionRef & {
    internal_actions: FunctionRef & {
      syncWebsiteRowForDomain: FunctionRef;
    };
    internal_mutations: FunctionRef & {
      clearScanFailures: FunctionRef;
      recordScanFailure: FunctionRef;
    };
    internal_queries: FunctionRef & {
      listWebsiteSummaries: FunctionRef;
      listWebsitesForScanScheduling: FunctionRef;
    };
  };
  z: FunctionRef & {
    ai: FunctionRef;
  };
}

/**
 * The Better Auth component's adapter, addressed the same way. Its seven
 * operations are the component client's fixed surface; the shim routes them
 * onto the auth tables in Postgres.
 */
interface ComponentNames {
  betterAuth: {
    adapter: {
      create: FunctionRef;
      findOne: FunctionRef;
      findMany: FunctionRef;
      updateOne: FunctionRef;
      updateMany: FunctionRef;
      deleteOne: FunctionRef;
      deleteMany: FunctionRef;
    };
  };
}

/** `api` and `internal` were the retired runtime's PUBLIC/PRIVATE split. The
 *  shim has one table, so they are the same tree under two names — kept
 *  because 75 reused modules say one or the other, and rewriting them would
 *  churn files that are moving to 0.5 domains anyway. */
export const api = createFunctionRefs<HandlerNames>();
export const internal = createFunctionRefs<HandlerNames>();
export const components = createComponentRefs<ComponentNames>();
