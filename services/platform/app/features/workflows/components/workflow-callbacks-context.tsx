'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';

/**
 * Context for workflow canvas callbacks
 *
 * IMPORTANT: This context exists to prevent infinite render loops in ReactFlow.
 * ReactFlow's StoreUpdater component watches for changes in node.data objects.
 * If callback functions are included in node.data, they create new object
 * references on each render, triggering an infinite loop of:
 *   render -> new data -> StoreUpdater detects change -> setNodes -> render
 *
 * By passing callbacks through context instead of node.data, we maintain
 * stable object references and avoid the infinite loop.
 */

interface WorkflowCallbacksContextType {
  /** Called when a node is clicked to open the side panel */
  onNodeClick: (stepSlug: string) => void;
}

const WorkflowCallbacksContext =
  createContext<WorkflowCallbacksContextType | null>(null);

export function WorkflowCallbacksProvider({
  children,
  onNodeClick,
}: WorkflowCallbacksContextType & { children: ReactNode }) {
  const value = useMemo(() => ({ onNodeClick }), [onNodeClick]);

  return (
    <WorkflowCallbacksContext.Provider value={value}>
      {children}
    </WorkflowCallbacksContext.Provider>
  );
}

export function useWorkflowCallbacks(): WorkflowCallbacksContextType {
  const context = useContext(WorkflowCallbacksContext);
  if (!context) {
    throw new Error(
      'useWorkflowCallbacks must be used within WorkflowCallbacksProvider',
    );
  }
  return context;
}
