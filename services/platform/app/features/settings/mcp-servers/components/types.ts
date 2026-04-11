interface DiscoveredTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  requiresApproval?: boolean;
}

export interface McpServerListItem {
  _id: string;
  _creationTime: number;
  organizationId: string;
  name: string;
  displayName: string;
  description?: string;
  transportType: 'stdio' | 'sse' | 'streamable_http';
  url?: string;
  command?: string;
  args?: string[];
  authType: 'none' | 'api_key' | 'oauth2';
  status: 'active' | 'inactive' | 'error';
  capabilities?: {
    tools?: boolean;
    resources?: boolean;
    prompts?: boolean;
  };
  discoveredTools?: DiscoveredTool[];
  lastConnectedAt?: number;
  lastError?: string;
}
