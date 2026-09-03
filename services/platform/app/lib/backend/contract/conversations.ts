/**
 * `conversations` — the wire contract for the backend calls the app makes into this
 * family: one entry per function name, carrying its argument and response
 * shapes. Materialized from the shapes the app consumed at the Convex
 * retirement, so the hook wrappers stay fully typed with no generated
 * `_generated/api` behind them; the adapter rows in `../conversations.ts` are what
 * actually serve them.
 */

export interface ConversationsContract {
  'conversations/actions:improveMessage': {
    kind: 'action';
    args: {
      instruction?: string;
      organizationId: string;
      originalMessage: string;
    };
    returns: { improvedMessage: string; error?: string };
  };
  'conversations/mutations:assignConversation': {
    kind: 'mutation';
    args: { assigneeUserId?: string; conversationId: string };
    returns: null;
  };
  'conversations/mutations:assignConversationTeam': {
    kind: 'mutation';
    args: { assigneeTeamId?: string; conversationId: string };
    returns: null;
  };
  'conversations/mutations:bulkArchiveConversations': {
    kind: 'mutation';
    args: { conversationIds: string[] };
    returns: { errors: string[]; successCount: number; failedCount: number };
  };
  'conversations/mutations:bulkCloseConversations': {
    kind: 'mutation';
    args: { resolvedBy?: string; conversationIds: string[] };
    returns: { errors: string[]; successCount: number; failedCount: number };
  };
  'conversations/mutations:bulkReopenConversations': {
    kind: 'mutation';
    args: { conversationIds: string[] };
    returns: { errors: string[]; successCount: number; failedCount: number };
  };
  'conversations/mutations:bulkSpamConversations': {
    kind: 'mutation';
    args: { conversationIds: string[] };
    returns: { errors: string[]; successCount: number; failedCount: number };
  };
  'conversations/mutations:bulkUnarchiveConversations': {
    kind: 'mutation';
    args: { conversationIds: string[] };
    returns: { errors: string[]; successCount: number; failedCount: number };
  };
  'conversations/mutations:closeConversation': {
    kind: 'mutation';
    args: { resolvedBy?: string; conversationId: string };
    returns: null;
  };
  'conversations/mutations:composeEmailConversation': {
    kind: 'mutation';
    args: {
      attachments?: Array<{
        storageId: string;
        fileName: string;
        size: number;
        contentType: string;
      }>;
      assigneeUserId?: string;
      assigneeTeamId?: string;
      from?: string;
      sourceMarkdown?: string;
      organizationId: string;
      content: string;
      connectorName: string;
      contactId: string;
      subject: string;
    };
    returns: { conversationId: string; messageId: string };
  };
  'conversations/mutations:deleteConversation': {
    kind: 'mutation';
    args: { conversationId: string };
    returns: null;
  };
  'conversations/mutations:discardOutboundMessage': {
    kind: 'mutation';
    args: { messageId: string };
    returns: null;
  };
  'conversations/mutations:downloadAttachments': {
    kind: 'mutation';
    args: { messageId: string };
    returns: null;
  };
  'conversations/mutations:markConversationAsRead': {
    kind: 'mutation';
    args: { conversationId: string };
    returns: null;
  };
  'conversations/mutations:markConversationAsSpam': {
    kind: 'mutation';
    args: { conversationId: string };
    returns: null;
  };
  'conversations/mutations:reopenConversation': {
    kind: 'mutation';
    args: { conversationId: string };
    returns: null;
  };
  'conversations/mutations:retrySendMessage': {
    kind: 'mutation';
    args: { messageId: string };
    returns: null;
  };
  'conversations/mutations:sendMessageViaConnector': {
    kind: 'mutation';
    args: {
      attachments?: Array<{
        storageId: string;
        fileName: string;
        size: number;
        contentType: string;
      }>;
      text?: string;
      cc?: string[];
      html?: string;
      inReplyTo?: string;
      references?: string[];
      sourceMarkdown?: string;
      organizationId: string;
      content: string;
      connectorName: string;
      conversationId: string;
      subject: string;
      to: string[];
    };
    returns: string;
  };
  'conversations/mutations:undoSendMessage': {
    kind: 'mutation';
    args: { messageId: string };
    returns: { sourceMarkdown: null | string };
  };
  'conversations/queries:approxCountConversationsByStatus': {
    kind: 'query';
    args: {
      connectorName?: string;
      status: 'archived' | 'open' | 'closed' | 'spam';
      organizationId: string;
    };
    returns: number;
  };
  'conversations/queries:getConversationWithMessages': {
    kind: 'query';
    args: { organizationId: string; conversationId: string };
    returns: null | {
      status?: 'archived' | 'open' | 'closed' | 'spam';
      metadata?: Record<string, unknown>;
      type?: string;
      priority?: string;
      direction?: 'inbound' | 'outbound';
      connectorName?: string;
      channel?: string;
      externalMessageId?: string;
      contactId?: string;
      assigneeUserId?: string;
      assigneeTeamId?: string;
      subject?: string;
      lastMessageAt?: number;
      senderName?: string;
      lastMessagePreview?: string;
      last_message_at?: string;
      last_read_at?: string;
      resolved_at?: string;
      resolved_by?: string;
      pendingApproval?: null | {
        metadata?: Record<string, unknown>;
        threadId?: string;
        messageId?: string;
        reviewedAt?: number;
        wfExecutionId?: string;
        stepSlug?: string;
        approvedBy?: string;
        dueDate?: number;
        executedAt?: number;
        executionError?: string;
        status: 'pending' | 'rejected' | 'executing' | 'completed';
        organizationId: string;
        _creationTime: number;
        resourceType:
          | 'conversations'
          | 'erasure'
          | 'connector_operation'
          | 'workflow_creation'
          | 'workflow_run'
          | 'workflow_update'
          | 'human_input_request'
          | 'document_write'
          | 'knowledge_write'
          | 'location_request'
          | 'mcp_tool_call'
          | 'task_review'
          | 'document_record_review'
          | 'external_agent_plan'
          | 'external_agent_human_control'
          | 'operator_input';
        resourceId: string;
        priority: 'low' | 'medium' | 'high' | 'urgent';
        _id: string;
      };
      messages: Array<{
        attachments?: Array<{
          storageId?: string;
          url?: string;
          contentId?: string;
          id: string;
          size: number;
          contentType: string;
          filename: string;
        }>;
        errorMessage?: string;
        scheduledSendAt?: number;
        attachment?: {
          size?: number;
          contentType?: string;
          url: string;
          filename: string;
        };
        status: 'queued' | 'failed' | 'sent' | 'delivered';
        id: string;
        content: string;
        timestamp: string;
        sender: string;
        isCustomer: boolean;
      }>;
      id: string;
      organizationId: string;
      _creationTime: number;
      title: string;
      description: string;
      _id: string;
      contact: {
        name?: string;
        locale?: string;
        source?: string;
        id: string;
        email: string;
        created_at: string;
      };
      created_at: string;
      contact_id: string;
      business_id: string;
      message_count: number;
      unread_count: number;
      updated_at: string;
    };
  };
  'conversations/queries:listConversations': {
    kind: 'query';
    args: { organizationId: string };
    returns: Array<{
      status?: 'archived' | 'open' | 'closed' | 'spam';
      metadata?: Record<string, unknown>;
      type?: string;
      priority?: string;
      direction?: 'inbound' | 'outbound';
      connectorName?: string;
      channel?: string;
      externalMessageId?: string;
      contactId?: string;
      assigneeUserId?: string;
      assigneeTeamId?: string;
      subject?: string;
      lastMessageAt?: number;
      senderName?: string;
      lastMessagePreview?: string;
      last_message_at?: string;
      last_read_at?: string;
      resolved_at?: string;
      resolved_by?: string;
      pendingApproval?: null | {
        metadata?: Record<string, unknown>;
        threadId?: string;
        messageId?: string;
        reviewedAt?: number;
        wfExecutionId?: string;
        stepSlug?: string;
        approvedBy?: string;
        dueDate?: number;
        executedAt?: number;
        executionError?: string;
        status: 'pending' | 'rejected' | 'executing' | 'completed';
        organizationId: string;
        _creationTime: number;
        resourceType:
          | 'conversations'
          | 'erasure'
          | 'connector_operation'
          | 'workflow_creation'
          | 'workflow_run'
          | 'workflow_update'
          | 'human_input_request'
          | 'document_write'
          | 'knowledge_write'
          | 'location_request'
          | 'mcp_tool_call'
          | 'task_review'
          | 'document_record_review'
          | 'external_agent_plan'
          | 'external_agent_human_control'
          | 'operator_input';
        resourceId: string;
        priority: 'low' | 'medium' | 'high' | 'urgent';
        _id: string;
      };
      messages: Array<{
        attachments?: Array<{
          storageId?: string;
          url?: string;
          contentId?: string;
          id: string;
          size: number;
          contentType: string;
          filename: string;
        }>;
        errorMessage?: string;
        scheduledSendAt?: number;
        attachment?: {
          size?: number;
          contentType?: string;
          url: string;
          filename: string;
        };
        status: 'queued' | 'failed' | 'sent' | 'delivered';
        id: string;
        content: string;
        timestamp: string;
        sender: string;
        isCustomer: boolean;
      }>;
      id: string;
      organizationId: string;
      _creationTime: number;
      title: string;
      description: string;
      _id: string;
      contact: {
        name?: string;
        locale?: string;
        source?: string;
        id: string;
        email: string;
        created_at: string;
      };
      created_at: string;
      contact_id: string;
      business_id: string;
      message_count: number;
      unread_count: number;
      updated_at: string;
    }>;
  };
  'conversations/queries:listConversationsPaginated': {
    kind: 'query';
    args: {
      status?: 'archived' | 'open' | 'closed' | 'spam';
      priority?: string;
      connectorName?: string;
      channel?: string;
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
        status?: 'archived' | 'open' | 'closed' | 'spam';
        metadata?: Record<string, unknown>;
        type?: string;
        priority?: string;
        direction?: 'inbound' | 'outbound';
        connectorName?: string;
        channel?: string;
        externalMessageId?: string;
        contactId?: string;
        assigneeUserId?: string;
        assigneeTeamId?: string;
        subject?: string;
        lastMessageAt?: number;
        senderName?: string;
        lastMessagePreview?: string;
        last_message_at?: string;
        last_read_at?: string;
        resolved_at?: string;
        resolved_by?: string;
        pendingApproval?: null | {
          metadata?: Record<string, unknown>;
          threadId?: string;
          messageId?: string;
          reviewedAt?: number;
          wfExecutionId?: string;
          stepSlug?: string;
          approvedBy?: string;
          dueDate?: number;
          executedAt?: number;
          executionError?: string;
          status: 'pending' | 'rejected' | 'executing' | 'completed';
          organizationId: string;
          _creationTime: number;
          resourceType:
            | 'conversations'
            | 'erasure'
            | 'connector_operation'
            | 'workflow_creation'
            | 'workflow_run'
            | 'workflow_update'
            | 'human_input_request'
            | 'document_write'
            | 'knowledge_write'
            | 'location_request'
            | 'mcp_tool_call'
            | 'task_review'
            | 'document_record_review'
            | 'external_agent_plan'
            | 'external_agent_human_control'
            | 'operator_input';
          resourceId: string;
          priority: 'low' | 'medium' | 'high' | 'urgent';
          _id: string;
        };
        messages: Array<{
          attachments?: Array<{
            storageId?: string;
            url?: string;
            contentId?: string;
            id: string;
            size: number;
            contentType: string;
            filename: string;
          }>;
          errorMessage?: string;
          scheduledSendAt?: number;
          attachment?: {
            size?: number;
            contentType?: string;
            url: string;
            filename: string;
          };
          status: 'queued' | 'failed' | 'sent' | 'delivered';
          id: string;
          content: string;
          timestamp: string;
          sender: string;
          isCustomer: boolean;
        }>;
        id: string;
        organizationId: string;
        _creationTime: number;
        title: string;
        description: string;
        _id: string;
        contact: {
          name?: string;
          locale?: string;
          source?: string;
          id: string;
          email: string;
          created_at: string;
        };
        created_at: string;
        contact_id: string;
        business_id: string;
        message_count: number;
        unread_count: number;
        updated_at: string;
      }>;
      isDone: boolean;
      continueCursor: string;
    };
  };
}
