/* oxlint-disable typescript/no-explicit-any -- a reference's only meaningful
   content here is its NAME; the shapes live at the boundaries that consume
   them. */
/**
 * The function-NAME vocabulary the reused 0.4 handlers address each other by.
 *
 * There is no Convex runtime behind these. `internal.a.b.c` builds a reference
 * whose meaningful content is the name `a/b:c`, and the 0.5 ctx shim
 * (`backend/lib/convex-shim.ts`) dispatches that name to a SQL-backed handler;
 * a name with no handler throws, loudly and by name, at the call.
 *
 * Every name is typed alike — kind included — because the shim keeps ONE
 * handler table and dispatches on the name alone; a query/mutation/action
 * distinction here would be precision the runtime does not have.
 *
 * HAND-MAINTAINED, not generated: the code generator retired with the runtime.
 * Add a line when a reused handler starts naming a new function, and give the
 * shim a handler for it in the same change — an entry without one is a runtime
 * refusal waiting to happen.
 */

import type { FunctionReference } from 'convex/server';

interface ApiNames {
  agent_secrets: FunctionReference<any, any, any, any> & {
    actions: FunctionReference<any, any, any, any> & {
      resolveAgentSecretsEnv: FunctionReference<any, any, any, any>;
    };
  };
  anthropic: FunctionReference<any, any, any, any> & {
    com: FunctionReference<any, any, any, any>;
  };
  approvals: FunctionReference<any, any, any, any> & {
    gate: FunctionReference<any, any, any, any> & {
      evaluateApprovalGate: FunctionReference<any, any, any, any>;
    };
  };
  audit_logs: FunctionReference<any, any, any, any> & {
    internal_mutations: FunctionReference<any, any, any, any> & {
      createAuditLog: FunctionReference<any, any, any, any>;
    };
  };
  automations: FunctionReference<any, any, any, any> & {
    agent_host: FunctionReference<any, any, any, any> & {
      driveWorkflowAgentTurn: FunctionReference<any, any, any, any>;
      startWorkflowAgentTurn: FunctionReference<any, any, any, any>;
    };
    human_asks: FunctionReference<any, any, any, any> & {
      closeAsk: FunctionReference<any, any, any, any>;
      createAskForExec: FunctionReference<any, any, any, any>;
      getAskForResume: FunctionReference<any, any, any, any>;
      getPendingAskForExec: FunctionReference<any, any, any, any>;
      listAnsweredAsksForNode: FunctionReference<any, any, any, any>;
      recordAskParked: FunctionReference<any, any, any, any>;
      retargetAgentCursor: FunctionReference<any, any, any, any>;
    };
    mutations: FunctionReference<any, any, any, any> & {
      claimRun: FunctionReference<any, any, any, any>;
      continueRun: FunctionReference<any, any, any, any>;
      finishRun: FunctionReference<any, any, any, any>;
      heartbeatRun: FunctionReference<any, any, any, any>;
      recordAgentTurnSettled: FunctionReference<any, any, any, any>;
      recordProgress: FunctionReference<any, any, any, any>;
      stampAgentTurnLaunch: FunctionReference<any, any, any, any>;
      storeCancelRun: FunctionReference<any, any, any, any>;
      storeDeleteTrigger: FunctionReference<any, any, any, any>;
      storeDeploy: FunctionReference<any, any, any, any>;
      storeRecordRun: FunctionReference<any, any, any, any>;
      storeSave: FunctionReference<any, any, any, any>;
      storeSetTrigger: FunctionReference<any, any, any, any>;
      storeStartRun: FunctionReference<any, any, any, any>;
      suspendRun: FunctionReference<any, any, any, any>;
    };
    queries: FunctionReference<any, any, any, any> & {
      getRunProjectContext: FunctionReference<any, any, any, any>;
      getRunProjectId: FunctionReference<any, any, any, any>;
      loadAutomationDocument: FunctionReference<any, any, any, any>;
      loadRunForStep: FunctionReference<any, any, any, any>;
      readAgentCursor: FunctionReference<any, any, any, any>;
      storeDeployedVersion: FunctionReference<any, any, any, any>;
      storeGet: FunctionReference<any, any, any, any>;
      storeGetRun: FunctionReference<any, any, any, any>;
      storeList: FunctionReference<any, any, any, any>;
      storeListRuns: FunctionReference<any, any, any, any>;
      storeListTriggers: FunctionReference<any, any, any, any>;
      storeListVersions: FunctionReference<any, any, any, any>;
    };
  };
  automations_builder: FunctionReference<any, any, any, any> & {
    run_session: FunctionReference<any, any, any, any> & {
      dispatchEngineMethod: FunctionReference<any, any, any, any>;
    };
  };
  browser_sessions: FunctionReference<any, any, any, any> & {
    sessions: FunctionReference<any, any, any, any> & {
      claimBrowserSession: FunctionReference<any, any, any, any>;
      reportBrowserSessionResult: FunctionReference<any, any, any, any>;
    };
  };
  chat: FunctionReference<any, any, any, any> & {
    branches: FunctionReference<any, any, any, any> & {
      getThreadLineageIds: FunctionReference<any, any, any, any>;
    };
    capabilities_action: FunctionReference<any, any, any, any> & {
      dispatchCapabilityAs: FunctionReference<any, any, any, any>;
    };
    generations: FunctionReference<any, any, any, any> & {
      endGenerationInternal: FunctionReference<any, any, any, any>;
      streamProgressInternal: FunctionReference<any, any, any, any>;
    };
    messages: FunctionReference<any, any, any, any> & {
      appendMessageInternal: FunctionReference<any, any, any, any>;
      finalizeAssistantMessageInternal: FunctionReference<any, any, any, any>;
      listRecentForTurnInternal: FunctionReference<any, any, any, any>;
      updateAssistantPartsInternal: FunctionReference<any, any, any, any>;
    };
    threads: FunctionReference<any, any, any, any> & {
      setThreadTitleInternal: FunctionReference<any, any, any, any>;
    };
    turn_setup: FunctionReference<any, any, any, any> & {
      beginTurnInternal: FunctionReference<any, any, any, any>;
    };
  };
  connector_credentials: FunctionReference<any, any, any, any> & {
    mutations: FunctionReference<any, any, any, any> & {
      patchCredentialInternal: FunctionReference<any, any, any, any>;
    };
    queries: FunctionReference<any, any, any, any> & {
      listActiveCredentialsInternal: FunctionReference<any, any, any, any>;
      listCredentials: FunctionReference<any, any, any, any>;
      resolveCredentialRefInternal: FunctionReference<any, any, any, any>;
    };
  };
  connectors: FunctionReference<any, any, any, any> & {
    execute_action: FunctionReference<any, any, any, any> & {
      runConnectorAction: FunctionReference<any, any, any, any>;
    };
  };
  contacts: FunctionReference<any, any, any, any> & {
    internal_mutations: FunctionReference<any, any, any, any> & {
      findOrCreateContact: FunctionReference<any, any, any, any>;
    };
    internal_queries: FunctionReference<any, any, any, any> & {
      queryContacts: FunctionReference<any, any, any, any>;
    };
  };
  conversations: FunctionReference<any, any, any, any> & {
    internal_actions: FunctionReference<any, any, any, any> & {
      sendMessageViaConnectorAction: FunctionReference<any, any, any, any>;
    };
    internal_mutations: FunctionReference<any, any, any, any> & {
      addMessageToConversation: FunctionReference<any, any, any, any>;
      createConversationWithMessage: FunctionReference<any, any, any, any>;
      updateConversationMessage: FunctionReference<any, any, any, any>;
    };
    internal_queries: FunctionReference<any, any, any, any> & {
      getConversationByExternalMessageId: FunctionReference<any, any, any, any>;
      getConversationById: FunctionReference<any, any, any, any>;
      getMessageByExternalId: FunctionReference<any, any, any, any>;
      queryLatestMessageByDeliveryState: FunctionReference<any, any, any, any>;
    };
    search_for_chat: FunctionReference<any, any, any, any> & {
      searchConversationsForChat: FunctionReference<any, any, any, any>;
    };
  };
  deepseek: FunctionReference<any, any, any, any> & {
    com: FunctionReference<any, any, any, any>;
  };
  documents: FunctionReference<any, any, any, any> & {
    internal_actions: FunctionReference<any, any, any, any> & {
      storeRawContent: FunctionReference<any, any, any, any>;
    };
    internal_mutations: FunctionReference<any, any, any, any> & {
      upsertDocumentByExternalId: FunctionReference<any, any, any, any>;
    };
    internal_queries: FunctionReference<any, any, any, any> & {
      filterRetrievableRagFileIds: FunctionReference<any, any, any, any>;
      findDocumentByFileId: FunctionReference<any, any, any, any>;
      listDocumentsForScope: FunctionReference<any, any, any, any>;
      listFilesByFolderInternal: FunctionReference<any, any, any, any>;
      listForAgent: FunctionReference<any, any, any, any>;
      resolveKnowledgeAccess: FunctionReference<any, any, any, any>;
    };
  };
  enterprise_sso: FunctionReference<any, any, any, any> & {
    config: FunctionReference<any, any, any, any> & {
      file_actions: FunctionReference<any, any, any, any> & {
        getConnectionSecrets: FunctionReference<any, any, any, any>;
      };
    };
    internal_actions: FunctionReference<any, any, any, any> & {
      handleSsoLogin: FunctionReference<any, any, any, any>;
    };
    internal_queries: FunctionReference<any, any, any, any> & {
      discoverByEmail: FunctionReference<any, any, any, any>;
      resolveSamlConfig: FunctionReference<any, any, any, any>;
      resolveSignInConfig: FunctionReference<any, any, any, any>;
    };
    saml: FunctionReference<any, any, any, any> & {
      validate_assertion: FunctionReference<any, any, any, any> & {
        buildSamlAuthnRedirect: FunctionReference<any, any, any, any>;
        validateSamlResponse: FunctionReference<any, any, any, any>;
      };
    };
  };
  example: FunctionReference<any, any, any, any> & {
    com: FunctionReference<any, any, any, any>;
    test: FunctionReference<any, any, any, any>;
  };
  file_metadata: FunctionReference<any, any, any, any> & {
    internal_mutations: FunctionReference<any, any, any, any> & {
      acquireTranscriptionLock: FunctionReference<any, any, any, any>;
      bindFileToConversation: FunctionReference<any, any, any, any>;
      bindStorageIdsToThread: FunctionReference<any, any, any, any>;
      linkDocumentToFile: FunctionReference<any, any, any, any>;
      releaseTranscriptionLock: FunctionReference<any, any, any, any>;
      saveFileMetadata: FunctionReference<any, any, any, any>;
      updateFileTranscription: FunctionReference<any, any, any, any>;
    };
    internal_queries: FunctionReference<any, any, any, any> & {
      filterStorageIdsInOrg: FunctionReference<any, any, any, any>;
      findCachedTranscript: FunctionReference<any, any, any, any>;
      getByStorageId: FunctionReference<any, any, any, any>;
      getStorageSha256: FunctionReference<any, any, any, any>;
      listMailAttachmentsForChat: FunctionReference<any, any, any, any>;
      lookupVideoLinkSources: FunctionReference<any, any, any, any>;
    };
    mutations: FunctionReference<any, any, any, any>;
    transcribe_audio: FunctionReference<any, any, any, any> & {
      transcribeAudio: FunctionReference<any, any, any, any>;
    };
  };
  files: FunctionReference<any, any, any, any> & {
    blob_actions: FunctionReference<any, any, any, any> & {
      deleteOrgBlobs: FunctionReference<any, any, any, any>;
      storeOrgBlob: FunctionReference<any, any, any, any>;
    };
  };
  fireworks: FunctionReference<any, any, any, any> & {
    ai: FunctionReference<any, any, any, any>;
  };
  github: FunctionReference<any, any, any, any> & {
    com: FunctionReference<any, any, any, any>;
  };
  governance: FunctionReference<any, any, any, any> & {
    internal_mutations: FunctionReference<any, any, any, any> & {
      incrementUsageLedger: FunctionReference<any, any, any, any>;
      recordConnectorUsage: FunctionReference<any, any, any, any>;
      recordTranscriptionUsage: FunctionReference<any, any, any, any>;
    };
    internal_queries: FunctionReference<any, any, any, any> & {
      getPolicyConfigInternal: FunctionReference<any, any, any, any>;
      resolveModelGovernanceInternal: FunctionReference<any, any, any, any>;
    };
    queries: FunctionReference<any, any, any, any> & {
      checkModelAccessInternal: FunctionReference<any, any, any, any>;
      getContextCapInternal: FunctionReference<any, any, any, any>;
    };
  };
  knowledge: FunctionReference<any, any, any, any> & {
    crawl_action: FunctionReference<any, any, any, any> & {
      scanWebsite: FunctionReference<any, any, any, any>;
    };
    crawl_ops: FunctionReference<any, any, any, any> & {
      deregisterDomainOp: FunctionReference<any, any, any, any>;
      homepageMetadataOp: FunctionReference<any, any, any, any>;
      registerDomainOp: FunctionReference<any, any, any, any>;
      registerUrlListOp: FunctionReference<any, any, any, any>;
      setScanIntervalOp: FunctionReference<any, any, any, any>;
      websiteInfoOp: FunctionReference<any, any, any, any>;
    };
  };
  knowledge_entries: FunctionReference<any, any, any, any> & {
    internal_queries: FunctionReference<any, any, any, any> & {
      listEntriesForAgent: FunctionReference<any, any, any, any>;
    };
  };
  legacy: FunctionReference<any, any, any, any> & {
    knowledge_delete: FunctionReference<any, any, any, any> & {
      deleteDocument: FunctionReference<any, any, any, any>;
    };
  };
  lib: FunctionReference<any, any, any, any> & {
    config_store: FunctionReference<any, any, any, any> & {
      actions: FunctionReference<any, any, any, any> & {
        readConfigArea: FunctionReference<any, any, any, any>;
      };
    };
  };
  login_attempts: FunctionReference<any, any, any, any> & {
    internal_queries: FunctionReference<any, any, any, any> & {
      getTrustedProxies: FunctionReference<any, any, any, any>;
    };
  };
  members: FunctionReference<any, any, any, any> & {
    internal_queries: FunctionReference<any, any, any, any> & {
      getMemberRole: FunctionReference<any, any, any, any>;
    };
  };
  notifications: FunctionReference<any, any, any, any> & {
    dispatch_notification: FunctionReference<any, any, any, any> & {
      dispatchNotificationAction: FunctionReference<any, any, any, any>;
    };
    email_notification: FunctionReference<any, any, any, any> & {
      deliverActionableEmailAction: FunctionReference<any, any, any, any>;
    };
  };
  openai: FunctionReference<any, any, any, any> & {
    com: FunctionReference<any, any, any, any>;
    example: FunctionReference<any, any, any, any>;
  };
  products: FunctionReference<any, any, any, any> & {
    internal_queries: FunctionReference<any, any, any, any> & {
      queryProducts: FunctionReference<any, any, any, any>;
    };
  };
  projects: FunctionReference<any, any, any, any> & {
    internal_queries: FunctionReference<any, any, any, any> & {
      assertProjectAccessForChat: FunctionReference<any, any, any, any>;
      getProjectAgentSkillScope: FunctionReference<any, any, any, any>;
      getProjectForInjection: FunctionReference<any, any, any, any>;
      getProjectIdForThread: FunctionReference<any, any, any, any>;
      getProjectLabelsForOrg: FunctionReference<any, any, any, any>;
      getProjectSkillScope: FunctionReference<any, any, any, any>;
    };
  };
  provider_credentials: FunctionReference<any, any, any, any> & {
    queries: FunctionReference<any, any, any, any> & {
      getCredentialInternal: FunctionReference<any, any, any, any>;
      getDefaultCredentialInternal: FunctionReference<any, any, any, any>;
      listActiveCredentialFactsInternal: FunctionReference<any, any, any, any>;
    };
  };
  sandbox: FunctionReference<any, any, any, any> & {
    session_mutations: FunctionReference<any, any, any, any> & {
      bumpSessionOpHeartbeat: FunctionReference<any, any, any, any>;
      claimSessionOpFinalize: FunctionReference<any, any, any, any>;
      hibernateAutomationScopedSession: FunctionReference<any, any, any, any>;
      insertSessionToken: FunctionReference<any, any, any, any>;
      markSessionRowDestroyed: FunctionReference<any, any, any, any>;
      markSessionTokenRevokedByKeyId: FunctionReference<any, any, any, any>;
      recordCredentialAccess: FunctionReference<any, any, any, any>;
      recordSessionOpSpend: FunctionReference<any, any, any, any>;
      recordToolCall: FunctionReference<any, any, any, any>;
      releaseProjectAgentSessionSlot: FunctionReference<any, any, any, any>;
      reserveSessionSlotAndInsert: FunctionReference<any, any, any, any>;
      resumeSessionSlotWithCapCheck: FunctionReference<any, any, any, any>;
      setSessionStatus: FunctionReference<any, any, any, any>;
      upsertSessionOp: FunctionReference<any, any, any, any>;
    };
    session_queries: FunctionReference<any, any, any, any> & {
      getActiveSessionByOwner: FunctionReference<any, any, any, any>;
      getExternalTurnOpForFinalize: FunctionReference<any, any, any, any>;
      getOpSteerState: FunctionReference<any, any, any, any>;
      getSessionOwnerIdentity: FunctionReference<any, any, any, any>;
    };
    workspace_access: FunctionReference<any, any, any, any> & {
      resolveKnowledgeToolAccess: FunctionReference<any, any, any, any>;
      resolveSessionActionContext: FunctionReference<any, any, any, any>;
      resolveWorkspaceReadAccess: FunctionReference<any, any, any, any>;
    };
  };
  scim: FunctionReference<any, any, any, any> & {
    internal_mutations: FunctionReference<any, any, any, any> & {
      deleteGroup: FunctionReference<any, any, any, any>;
      deprovisionUser: FunctionReference<any, any, any, any>;
      patchGroup: FunctionReference<any, any, any, any>;
      patchUser: FunctionReference<any, any, any, any>;
      provisionGroup: FunctionReference<any, any, any, any>;
      provisionUser: FunctionReference<any, any, any, any>;
      replaceGroup: FunctionReference<any, any, any, any>;
      touchConfigLastUsed: FunctionReference<any, any, any, any>;
    };
    internal_queries: FunctionReference<any, any, any, any> & {
      findGroupRecordByDisplayName: FunctionReference<any, any, any, any>;
      findUserRecordByUserName: FunctionReference<any, any, any, any>;
      getConfigByTokenHash: FunctionReference<any, any, any, any>;
      getGroupRecord: FunctionReference<any, any, any, any>;
      getUserRecord: FunctionReference<any, any, any, any>;
      listGroupRecords: FunctionReference<any, any, any, any>;
      listUserRecords: FunctionReference<any, any, any, any>;
    };
  };
  skills: FunctionReference<any, any, any, any> & {
    file_actions: FunctionReference<any, any, any, any> & {
      readSkillBundle: FunctionReference<any, any, any, any>;
    };
    upload_mutations: FunctionReference<any, any, any, any> & {
      deleteSkillUploadIntent: FunctionReference<any, any, any, any>;
    };
  };
  tasks: FunctionReference<any, any, any, any> & {
    agent_run_host: FunctionReference<any, any, any, any> & {
      driveTaskAgentTurn: FunctionReference<any, any, any, any>;
      steerTaskAgentTurn: FunctionReference<any, any, any, any>;
    };
    agent_runs: FunctionReference<any, any, any, any> & {
      getTaskAgentRunForDrive: FunctionReference<any, any, any, any>;
      getTaskBriefForAgentRun: FunctionReference<any, any, any, any>;
      markTaskAgentRunFailed: FunctionReference<any, any, any, any>;
      markTaskAgentRunSettled: FunctionReference<any, any, any, any>;
      parkTaskAgentRunForCapacity: FunctionReference<any, any, any, any>;
      rotateTaskAgentRunExec: FunctionReference<any, any, any, any>;
      setTaskAgentRunRunning: FunctionReference<any, any, any, any>;
      stampTaskAgentRunBrokerToken: FunctionReference<any, any, any, any>;
    };
    internal_mutations: FunctionReference<any, any, any, any> & {
      agentAddComment: FunctionReference<any, any, any, any>;
      agentCreateTask: FunctionReference<any, any, any, any>;
      agentRecordTaskOutputs: FunctionReference<any, any, any, any>;
      agentUpdateTaskStatus: FunctionReference<any, any, any, any>;
      agentUpsertTaskByExternalRef: FunctionReference<any, any, any, any>;
    };
    internal_queries: FunctionReference<any, any, any, any> & {
      getTaskByIdInternal: FunctionReference<any, any, any, any>;
      getTaskContextForAgent: FunctionReference<any, any, any, any>;
      listTasksForAgent: FunctionReference<any, any, any, any>;
    };
    mutations: FunctionReference<any, any, any, any> & {
      kickMentionRunAfterSteerMiss: FunctionReference<any, any, any, any>;
    };
    search_for_chat: FunctionReference<any, any, any, any> & {
      searchProjectsForChat: FunctionReference<any, any, any, any>;
      searchTasksForChat: FunctionReference<any, any, any, any>;
    };
  };
  two_factor: FunctionReference<any, any, any, any> & {
    internal_mutations: FunctionReference<any, any, any, any> & {
      clearOnSuccess: FunctionReference<any, any, any, any>;
      logEnrollmentEvent: FunctionReference<any, any, any, any>;
      recordFailure: FunctionReference<any, any, any, any>;
      setGraceUntilIfAbsent: FunctionReference<any, any, any, any>;
    };
    internal_queries: FunctionReference<any, any, any, any> & {
      evaluateEnforcement: FunctionReference<any, any, any, any>;
      getLockStateByUserId: FunctionReference<any, any, any, any>;
    };
  };
  user_preferences: FunctionReference<any, any, any, any> & {
    queries: FunctionReference<any, any, any, any> & {
      getChatModelInternal: FunctionReference<any, any, any, any>;
    };
  };
  video_links: FunctionReference<any, any, any, any> & {
    ingest_video_link: FunctionReference<any, any, any, any> & {
      ingestVideoLink: FunctionReference<any, any, any, any>;
    };
    internal_mutations: FunctionReference<any, any, any, any> & {
      cleanupCancelledVideoLink: FunctionReference<any, any, any, any>;
      heartbeatJobByStorageId: FunctionReference<any, any, any, any>;
      insertSyntheticFileMetadata: FunctionReference<any, any, any, any>;
      updateJob: FunctionReference<any, any, any, any>;
    };
    internal_queries: FunctionReference<any, any, any, any> & {
      getJobById: FunctionReference<any, any, any, any>;
    };
  };
  websites: FunctionReference<any, any, any, any> & {
    internal_actions: FunctionReference<any, any, any, any> & {
      syncWebsiteRowForDomain: FunctionReference<any, any, any, any>;
    };
    internal_mutations: FunctionReference<any, any, any, any> & {
      clearScanFailures: FunctionReference<any, any, any, any>;
      deleteWebsite: FunctionReference<any, any, any, any>;
      recordScanFailure: FunctionReference<any, any, any, any>;
    };
    internal_queries: FunctionReference<any, any, any, any> & {
      listWebsiteSummaries: FunctionReference<any, any, any, any>;
      listWebsitesForScanScheduling: FunctionReference<any, any, any, any>;
    };
  };
  z: FunctionReference<any, any, any, any> & {
    ai: FunctionReference<any, any, any, any>;
  };
}

export declare const api: ApiNames;
export declare const internal: ApiNames;

/** The Better Auth component's adapter, reached the same way. Its seven
 *  operations are the component client's fixed surface; the shim routes them
 *  onto the auth tables in Postgres. */
export declare const components: {
  betterAuth: {
    adapter: {
      create: FunctionReference<any, any, any, any>;
      findOne: FunctionReference<any, any, any, any>;
      findMany: FunctionReference<any, any, any, any>;
      updateOne: FunctionReference<any, any, any, any>;
      updateMany: FunctionReference<any, any, any, any>;
      deleteOne: FunctionReference<any, any, any, any>;
      deleteMany: FunctionReference<any, any, any, any>;
    };
  };
};
