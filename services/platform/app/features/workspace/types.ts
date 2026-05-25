/**
 * Shared types for the thread-workspace canvas. Mirror the shape the
 * `threadFiles` Convex queries return for the UI.
 */

export interface ThreadFileItem {
  path: string;
  size: number;
  contentType: string;
  source: 'user_upload' | 'agent_write' | 'run_output';
  updatedAt: number;
  renderHint?:
    | 'html'
    | 'svg'
    | 'mermaid'
    | 'markdown'
    | 'code'
    | 'image'
    | 'attachment';
}
