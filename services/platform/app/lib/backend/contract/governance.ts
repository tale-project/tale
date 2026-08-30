/**
 * `governance` — the wire contract for the backend calls the app makes into this
 * family: one entry per function name, carrying its argument and response
 * shapes. Materialized from the shapes the app consumed at the Convex
 * retirement, so the hook wrappers stay fully typed with no generated
 * `_generated/api` behind them; the adapter rows in `../governance.ts` are what
 * actually serve them.
 */

export interface GovernanceContract {
  'governance/dsar_policy:cancelPendingDsarPolicyChange': {
    kind: 'mutation';
    args: { organizationId: string };
    returns: null;
  };
  'governance/dsar_policy:getDsarPolicyForUi': {
    kind: 'query';
    args: { organizationId: string };
    returns: {
      config: {
        coolingOffHours: number;
        requireDualApproval: boolean;
        dailyLimitPerAdmin: number;
      };
      pending: null | {
        config: {
          coolingOffHours: number;
          requireDualApproval: boolean;
          dailyLimitPerAdmin: number;
        };
        effectiveAt: number;
        proposedBy: string;
        proposedByEmail?: string;
        proposedAt: number;
      };
      callerIsOwner: boolean;
    };
  };
  'governance/dsar_policy:proposeDsarPolicy': {
    kind: 'action';
    args: {
      config: {
        coolingOffHours: number;
        requireDualApproval: boolean;
        dailyLimitPerAdmin: number;
      };
      organizationId: string;
    };
    returns:
      | { applied: boolean; effectiveAt?: undefined }
      | { applied: boolean; effectiveAt: number };
  };
  'governance/erasure:cancelErasureRequest': {
    kind: 'mutation';
    args: { requestId: string; cancellationReason: string };
    returns: null;
  };
  'governance/erasure:extendErasureDeadline': {
    kind: 'mutation';
    args: { requestId: string; extensionReason: string; extraDays: number };
    returns: { extensionDeadlineAt: number };
  };
  'governance/erasure:requestErasure': {
    kind: 'mutation';
    args: {
      organizationId: string;
      userId: string;
      reason: string;
      reasonCode:
        | 'consent_withdrawn'
        | 'no_longer_necessary'
        | 'unlawful_processing'
        | 'legal_obligation'
        | 'objection'
        | 'child'
        | 'contract_termination';
    };
    returns: { requestId: string; threadsTargeted: number };
  };
  'governance/erasure:retryErasureRequest': {
    kind: 'mutation';
    args: { requestId: string };
    returns: null;
  };
  'governance/erasure_queries:getErasureRequest': {
    kind: 'query';
    args: { requestId: string };
    returns: {
      request: {
        _id: string;
        organizationId: string;
        targetUserId: string;
        targetUserName: string;
        reason: string;
        reasonCode:
          | undefined
          | 'consent_withdrawn'
          | 'no_longer_necessary'
          | 'unlawful_processing'
          | 'legal_obligation'
          | 'objection'
          | 'child'
          | 'contract_termination';
        requestedBy: string;
        requestedByName: string;
        requestedAt: number;
        slaDeadlineAt: number;
        status:
          | 'running'
          | 'failed'
          | 'cancelled'
          | 'pending'
          | 'partial'
          | 'done'
          | 'blocked';
        threadsTargeted: undefined | string[];
        threadsErased: undefined | number;
        threadsSkippedByHold: undefined | number;
        threadsBlockedByHold: undefined | string[];
        documentsBlockedByHold: undefined | string[];
        ragDocumentsRemoved: undefined | number;
        documentsErased: undefined | number;
        documentsSkippedByHold: undefined | number;
        wfExecutionsErased: undefined | number;
        errorMessage: undefined | string;
        startedAt: undefined | number;
        completedAt: undefined | number;
        lateFinalizeAt: undefined | number;
        perCategorySnapshot: Record<string, unknown>;
        effectiveAt: undefined | number;
        cancelledAt: undefined | number;
        cancelledBy: undefined | string;
        cancelledByName: undefined | string;
        cancellationReason: undefined | string;
        extensionGrantedAt: undefined | number;
        extensionGrantedBy: undefined | string;
        extensionGrantedByName: undefined | string;
        extensionReason: undefined | string;
        extensionDeadlineAt: undefined | number;
      };
      auditEntries: Array<{
        metadata?: Record<string, unknown>;
        lifecycleStatus?: 'active' | 'trashed' | 'expired' | 'deleted';
        statusChangedAt?: number;
        sessionId?: string;
        resourceId?: string;
        actorEmail?: string;
        actorRole?: string;
        resourceName?: string;
        previousState?: Record<string, unknown>;
        newState?: Record<string, unknown>;
        changedFields?: string[];
        ipAddress?: string;
        userAgent?: string;
        requestId?: string;
        actorEmailHash?: string;
        actorIpHash?: string;
        errorMessage?: string;
        integrityHash?: string;
        previousHash?: string;
        chainSuccessor?: string;
        piiScrubbed?: boolean;
        piiScrubbedAt?: number;
        status: 'success' | 'failure' | 'denied';
        organizationId: string;
        _creationTime: number;
        resourceType: string;
        actorType: 'user' | 'system' | 'api' | 'workflow';
        category:
          | 'auth'
          | 'data'
          | 'workflow'
          | 'member'
          | 'connector'
          | 'integration'
          | 'security'
          | 'admin'
          | 'ai'
          | 'skill'
          | 'agent';
        actorId: string;
        action: string;
        timestamp: number;
        _id: string;
      }>;
    };
  };
  'governance/erasure_queries:listErasureRequests': {
    kind: 'query';
    args: {
      statuses?: Array<
        | 'running'
        | 'failed'
        | 'cancelled'
        | 'pending'
        | 'partial'
        | 'done'
        | 'blocked'
      >;
      organizationId: string;
      paginationOpts: {
        id?: number;
        endCursor?: null | string;
        maximumRowsRead?: number;
        maximumBytesRead?: number;
        numItems: number;
        cursor: null | string;
      };
    };
    returns: {
      page: Array<{
        _id: string;
        organizationId: string;
        targetUserId: string;
        targetUserName: string;
        reason: string;
        reasonCode:
          | undefined
          | 'consent_withdrawn'
          | 'no_longer_necessary'
          | 'unlawful_processing'
          | 'legal_obligation'
          | 'objection'
          | 'child'
          | 'contract_termination';
        requestedBy: string;
        requestedByName: string;
        requestedAt: number;
        slaDeadlineAt: number;
        status:
          | 'running'
          | 'failed'
          | 'cancelled'
          | 'pending'
          | 'partial'
          | 'done'
          | 'blocked';
        threadsTargeted: undefined | number;
        threadsErased: undefined | number;
        ragDocumentsRemoved: undefined | number;
        documentsErased: undefined | number;
        documentsSkippedByHold: undefined | number;
        errorMessage: undefined | string;
        startedAt: undefined | number;
        completedAt: undefined | number;
        effectiveAt: undefined | number;
        cancelledAt: undefined | number;
        cancelledBy: undefined | string;
        cancellationReason: undefined | string;
        extensionGrantedAt: undefined | number;
        extensionGrantedBy: undefined | string;
        extensionGrantedByName: undefined | string;
        extensionReason: undefined | string;
        extensionDeadlineAt: undefined | number;
      }>;
      isDone: boolean;
      continueCursor: string;
    };
  };
  'governance/file_actions:saveGovernancePolicy': {
    kind: 'action';
    args: { config: unknown; organizationId: string; policyType: string };
    returns: null;
  };
  'governance/legal_hold:approveLegalHoldRelease': {
    kind: 'mutation';
    args: { organizationId: string; requestId: string };
    returns: null;
  };
  'governance/legal_hold:closeLegalMatter': {
    kind: 'mutation';
    args: { releaseReason?: string; matterId: string };
    returns: { releaseRequestsFiled: number };
  };
  'governance/legal_hold:placeLegalHold': {
    kind: 'mutation';
    args: {
      matterRef?: string;
      organizationId: string;
      targetType: 'userMembership' | 'org';
      targetId: string;
      reason: string;
    };
    returns: string;
  };
  'governance/legal_hold:rejectLegalHoldRelease': {
    kind: 'mutation';
    args: { organizationId: string; requestId: string; reason: string };
    returns: null;
  };
  'governance/legal_hold:requestLegalHoldRelease': {
    kind: 'mutation';
    args: { organizationId: string; reason: string; holdId: string };
    returns: string;
  };
  'governance/legal_hold:upsertLegalMatter': {
    kind: 'mutation';
    args: {
      caseNumber?: string;
      description?: string;
      matterId?: string;
      organizationId: string;
      name: string;
    };
    returns: string;
  };
  'governance/legal_hold_queries:getLegalHoldByTarget': {
    kind: 'query';
    args: {
      organizationId: string;
      targetType:
        | 'document'
        | 'thread'
        | 'execution'
        | 'userMembership'
        | 'org';
      targetId: string;
    };
    returns:
      | null
      | {
          _id: string;
          targetType:
            | 'document'
            | 'thread'
            | 'execution'
            | 'userMembership'
            | 'org';
          targetId: string;
          placedAt: number;
          view: 'member';
          via: 'direct' | 'org' | 'user_custodian';
          hasPendingRelease: boolean;
          hasApprovedRelease: boolean;
          effectiveAt: undefined | number;
          reason?: undefined;
          matterRef?: undefined;
          matterName?: undefined;
          placedBy?: undefined;
          placedByName?: undefined;
        }
      | {
          _id: string;
          targetType:
            | 'document'
            | 'thread'
            | 'execution'
            | 'userMembership'
            | 'org';
          targetId: string;
          placedAt: number;
          view: 'admin';
          via: 'direct' | 'org' | 'user_custodian';
          reason: string;
          matterRef: undefined | string;
          matterName: undefined | string;
          placedBy: string;
          placedByName: string;
          hasPendingRelease: boolean;
          hasApprovedRelease: boolean;
          effectiveAt: undefined | number;
        };
  };
  'governance/legal_hold_queries:listActiveHoldTargetIds': {
    kind: 'query';
    args: {
      organizationId: string;
      targetType:
        | 'document'
        | 'thread'
        | 'execution'
        | 'userMembership'
        | 'org';
    };
    returns: { orgHeld: boolean; targetIds: string[] };
  };
  'governance/legal_hold_queries:listLegalHoldReleaseRequests': {
    kind: 'query';
    args: {
      status: 'pending' | 'approved' | 'rejected' | 'effected';
      organizationId: string;
    };
    returns: Array<{
      _id: string;
      organizationId: string;
      holdId: string;
      targetType:
        | undefined
        | 'document'
        | 'thread'
        | 'execution'
        | 'userMembership'
        | 'org';
      targetId: undefined | string;
      requestedBy: string;
      requestedByName: string;
      requestedAt: number;
      reason: string;
      status: 'pending' | 'approved' | 'rejected' | 'effected';
      approvedBy: undefined | string;
      approvedByName: undefined | string;
      approvedAt: undefined | number;
      effectiveAt: undefined | number;
      rejectedBy: undefined | string;
      rejectedByName: undefined | string;
      rejectedAt: undefined | number;
      rejectReason: undefined | string;
    }>;
  };
  'governance/legal_hold_queries:listLegalHoldReleaseRequestsPaginated': {
    kind: 'query';
    args: {
      status: 'pending' | 'approved' | 'rejected' | 'effected';
      organizationId: string;
      paginationOpts: {
        id?: number;
        endCursor?: null | string;
        maximumRowsRead?: number;
        maximumBytesRead?: number;
        numItems: number;
        cursor: null | string;
      };
    };
    returns: {
      page: Array<{
        _id: string;
        organizationId: string;
        holdId: string;
        targetType:
          | undefined
          | 'document'
          | 'thread'
          | 'execution'
          | 'userMembership'
          | 'org';
        targetId: undefined | string;
        requestedBy: string;
        requestedByName: string;
        requestedAt: number;
        reason: string;
        status: 'pending' | 'approved' | 'rejected' | 'effected';
        approvedBy: undefined | string;
        approvedByName: undefined | string;
        approvedAt: undefined | number;
        effectiveAt: undefined | number;
        rejectedBy: undefined | string;
        rejectedByName: undefined | string;
        rejectedAt: undefined | number;
        rejectReason: undefined | string;
      }>;
      isDone: boolean;
      continueCursor: string;
    };
  };
  'governance/legal_hold_queries:listLegalHolds': {
    kind: 'query';
    args: {
      status?: 'active' | 'all' | 'released';
      targetType?:
        | 'document'
        | 'thread'
        | 'execution'
        | 'userMembership'
        | 'org';
      organizationId: string;
    };
    returns: Array<{
      _id: string;
      organizationId: string;
      targetType:
        | 'document'
        | 'thread'
        | 'execution'
        | 'userMembership'
        | 'org';
      targetId: string;
      targetLabel: string;
      reason: string;
      matterRef: undefined | string;
      matterName: undefined | string;
      placedBy: string;
      placedByName: string;
      placedAt: number;
      releasedAt: undefined | number;
      releasedBy: undefined | string;
      releasedByName: undefined | string;
      releaseReason: undefined | string;
    }>;
  };
  'governance/legal_hold_queries:listLegalMatters': {
    kind: 'query';
    args: { status?: 'open' | 'closed' | 'all'; organizationId: string };
    returns: Array<{
      _id: string;
      organizationId: string;
      name: string;
      caseNumber?: string;
      description?: string;
      status: 'open' | 'closed';
      createdBy: string;
      createdByName: string;
      createdAt: number;
      closedBy?: string;
      closedByName?: string;
      closedAt?: number;
      linkedActiveHolds: number;
    }>;
  };
  'governance/legal_hold_queries:listOrgMembersForPicker': {
    kind: 'query';
    args: { organizationId: string };
    returns: Array<{
      userId: string;
      email: string;
      displayName: string;
      role: string;
    }>;
  };
  'governance/moderation_provider/secrets:hasModerationSecret': {
    kind: 'action';
    args: { organizationId: string };
    returns: null | string;
  };
  'governance/moderation_provider/secrets:saveModerationSecret': {
    kind: 'action';
    args: { organizationId: string; authHeader: string };
    returns: null;
  };
  'governance/moderation_provider/test_action:testModerationProvider': {
    kind: 'action';
    args: {
      direction?: 'input' | 'output';
      text: string;
      organizationId: string;
    };
    returns: {
      ok: boolean;
      kind:
        | 'blocked'
        | 'step_error'
        | 'pass'
        | 'modified'
        | 'flagged'
        | 'not_configured';
      categoryIds?: string[];
      matchCount?: number;
      httpStatus?: number;
      durationMs?: number;
      errorClass?:
        | 'config'
        | 'timeout'
        | 'network'
        | 'parse'
        | 'http_4xx'
        | 'http_5xx'
        | 'unknown';
      circuitOpened?: boolean;
      hint?: string;
    };
  };
  'governance/queries:getAccessibleModelsForUser': {
    kind: 'query';
    args: { organizationId: string; modelIds: string[] };
    returns: string[];
  };
  'governance/queries:getMyBudgetStatus': {
    kind: 'query';
    args: { selectedTeamId?: null | string; organizationId: string };
    returns:
      | null
      | {
          exceeded: true;
          code: null | 'TOKEN_LIMIT' | 'COST_LIMIT' | 'REQUEST_LIMIT';
          period: null | string;
          used: null | number;
          limit: null | number;
          reason: null | string;
          warnings: null;
        }
      | {
          exceeded: false;
          code: null;
          period: null;
          used: null;
          limit: null;
          reason: null;
          warnings: Array<{
            code: 'TOKEN_WARNING' | 'COST_WARNING' | 'REQUEST_WARNING';
            period: string;
            used: number;
            limit: number;
            percent: number;
          }>;
        };
  };
  'governance/queries:getMyFeatureFlags': {
    kind: 'query';
    args: { organizationId: string };
    returns: {
      inputGuardrailsActive: boolean;
      webSearch: boolean;
      codeExecution: boolean;
      fileUpload: boolean;
      maxContextTokens?: number;
    };
  };
  'governance/queries:getOrgUsageMetrics': {
    kind: 'query';
    args: {
      agentSlug?: string;
      model?: string;
      provider?: string;
      organizationId: string;
      granularity: 'daily' | 'weekly' | 'monthly';
      periodDays: 7 | 30 | 90;
    };
    returns: {
      summary: {
        totalRequests: number;
        totalInputTokens: number;
        totalOutputTokens: number;
        totalTokens: number;
        totalCostCents: number;
        activeUsers: number;
        capped: boolean;
      };
      previousSummary: {
        totalRequests: number;
        totalTokens: number;
        totalCostCents: number;
        activeUsers: number;
      };
      series: Array<{
        periodKey: string;
        requests: number;
        inputTokens: number;
        outputTokens: number;
        tokens: number;
        costCents: number;
      }>;
      topAgents: Array<{
        agentSlug: string;
        requests: number;
        tokens: number;
        costCents: number;
      }>;
      topModels: Array<{
        provider: string;
        model: string;
        requests: number;
        tokens: number;
        costCents: number;
      }>;
      topVoiceModels: Array<{
        provider: string;
        model: string;
        requests: number;
        characters: number;
        costCents: number;
      }>;
      users: Array<{
        userId: string;
        displayName: string;
        teamId: null | string;
        inputTokens: number;
        outputTokens: number;
        tokens: number;
        costCents: number;
        requests: number;
      }>;
    };
  };
  'governance/queries:getPendingRetentionChange': {
    kind: 'query';
    args: { organizationId: string };
    returns: null | {
      _id: string;
      appliesAt: number;
      summary: string;
      requestedBy: string;
      requestedAt: number;
    };
  };
  'governance/queries:getPolicy': {
    kind: 'query';
    args: {
      organizationId: string;
      policyType:
        | 'review_policy'
        | 'moderation_provider'
        | 'system_prompt'
        | 'budgets'
        | 'upload_policy'
        | 'retention_policy'
        | 'feature_flags'
        | 'pii_config'
        | 'default_models'
        | 'model_access'
        | 'login_policy'
        | 'password_policy'
        | 'two_factor_policy'
        | 'session_idle_timeout'
        | 'chat_filter'
        | 'custom_instructions'
        | 'user_memories'
        | 'voice_output'
        | 'data_classification_notice'
        | 'dsar_governance'
        | 'agent_workforce'
        | 'agent_jobs'
        | 'task_automation'
        | 'run_code'
        | 'model_sync'
        | 'sandbox_quota'
        | 'conversation_access'
        | 'conversation_routing'
        | 'vision_model';
    };
    returns: null | {
      _id: string;
      _creationTime: number;
      enabled?: boolean;
      effectiveAt?: number;
      config: unknown;
      organizationId: string;
      domain: string;
      key: string;
      syncedAt: number;
    };
  };
  'governance/queries:listTrashedRows': {
    kind: 'query';
    args: {
      cursor?: null | { id: string; ts: number };
      limit?: number;
      resourceTypes?: Array<
        | 'document'
        | 'thread'
        | 'usageLedger'
        | 'messageFeedback'
        | 'fileMetadata'
        | 'contact'
        | 'chatThread'
        | 'externalConversation'
        | 'workflowExecution'
        | 'automationRun'
        | 'auditLog'
        | 'chatFilterEvent'
      >;
      organizationId: string;
    };
    returns: {
      rows: Array<{
        resourceType:
          | 'document'
          | 'thread'
          | 'usageLedger'
          | 'messageFeedback'
          | 'fileMetadata'
          | 'contact'
          | 'chatThread'
          | 'externalConversation'
          | 'workflowExecution'
          | 'automationRun'
          | 'auditLog'
          | 'chatFilterEvent';
        id: string;
        status: 'trashed' | 'expired';
        statusChangedAt: null | number;
        createdAt: number;
        displayName: null | string;
        ownerId: null | string;
        ownerName: null | string;
      }>;
      nextCursor: null | { ts: number; id: string };
    };
  };
  'governance/restore:restoreSoftDeletedRow': {
    kind: 'mutation';
    args: {
      organizationId: string;
      resourceType:
        | 'document'
        | 'thread'
        | 'usageLedger'
        | 'messageFeedback'
        | 'fileMetadata'
        | 'contact'
        | 'chatThread'
        | 'externalConversation'
        | 'workflowExecution'
        | 'automationRun'
        | 'auditLog'
        | 'chatFilterEvent';
      rowId: string;
    };
    returns: null;
  };
  'governance/retention_actions:cancelPendingRetentionChange': {
    kind: 'action';
    args: { organizationId: string; pendingId: string };
    returns: null;
  };
  'governance/retention_actions:getRetentionBoundsAction': {
    kind: 'action';
    args: { organizationId: string };
    returns: {
      bounds: Array<{
        category:
          | 'notifications'
          | 'contacts'
          | 'documents'
          | 'chatFilterEvents'
          | 'usageLedger'
          | 'messageFeedback'
          | 'auditLog'
          | 'userTempHours'
          | 'agentTempHours'
          | 'chatHistory'
          | 'workflowLog'
          | 'loginAttempt'
          | 'externalConversations'
          | 'agentRuns';
        min: number;
        max: number;
        default: number;
        unit: 'days' | 'hours';
        source: 'file' | 'env';
        minEnv: {
          envName: string;
          source: 'metadata' | 'none';
          applied: boolean;
        };
        maxEnv: {
          envName: string;
          source: 'metadata' | 'none';
          applied: boolean;
        };
        defaultEnv: {
          envName: string;
          source: 'metadata' | 'none';
          applied: boolean;
        };
      }>;
      retentionDisabled: boolean;
    };
  };
  'governance/retention_actions:upsertRetentionPolicyAction': {
    kind: 'action';
    args: { config: unknown; organizationId: string };
    returns: null;
  };
  'governance/retention_bounds_proposal:applyBoundsProposal': {
    kind: 'action';
    args: { organizationId: string; proposedHash: string };
    returns: string;
  };
  'governance/retention_bounds_proposal:getPendingBoundsProposal': {
    kind: 'action';
    args: { organizationId: string };
    returns: null | {
      firstApply: boolean;
      proposedBounds: Record<string, { min: number; max: number }>;
      proposedHash: string;
      appliedBounds: null | Record<string, { min: number; max: number }>;
      diff: Array<{
        category: string;
        field: 'max' | 'min';
        from: null | number;
        to: null | number;
        direction: 'tighten' | 'loosen';
      }>;
      impactPreview: Array<{
        category: string;
        field: string;
        current: number;
        willClampTo: number;
      }>;
    };
  };
  'governance/retention_bounds_proposal:rejectBoundsProposal': {
    kind: 'action';
    args: { organizationId: string; proposedHash: string };
    returns: null;
  };
}
