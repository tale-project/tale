'use client';

import { createContext, useContext, type ReactNode } from 'react';

/**
 * Context for automation workflow callbacks
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

interface AutomationCallbacksContextType {
  /** Called when a node is clicked to open the side panel */
  onNodeClick: (stepSlug: string) => void;
  /** Called when the add step button on a leaf node is clicked */
  onAddStep: (stepSlug: string) => void;
  /** Called when adding a step on an edge */
  onAddStepOnEdge: (sourceId: string, targetId: string) => void;
  /** Called when deleting an edge */
  onDeleteEdge: (edgeId: string) => void;
}

const AutomationCallbacksContext =
  createContext<AutomationCallbacksContextType | null>(null);

export function AutomationCallbacksProvider({
  children,
  onNodeClick,
  onAddStep,
  onAddStepOnEdge,
  onDeleteEdge,
}: AutomationCallbacksContextType & { children: ReactNode }) {
  return (
    <AutomationCallbacksContext.Provider
      value={{ onNodeClick, onAddStep, onAddStepOnEdge, onDeleteEdge }}
    >
      {children}
    </AutomationCallbacksContext.Provider>
  );
}

export function useAutomationCallbacks(): AutomationCallbacksContextType {
  const context = useContext(AutomationCallbacksContext);
  if (!context) {
    throw new Error(
      'useAutomationCallbacks must be used within AutomationCallbacksProvider',
    );
  }
  return context;
}
