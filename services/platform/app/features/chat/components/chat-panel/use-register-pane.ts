'use client';

import { useEffect, useRef } from 'react';

import { useChatPanel } from './chat-panel-context';
import type { ChatPaneDescriptor, ChatPaneId } from './types';

/**
 * Publish a pane's descriptor to the shell. The descriptor should be memoized
 * by the caller (so the registry only updates when something actually changed)
 * and is unregistered on unmount. Pass `null` to skip registration entirely —
 * e.g. before a `threadId` resolves — without breaking the rules-of-hooks
 * order.
 */
export function useRegisterPane(descriptor: ChatPaneDescriptor | null) {
  const { registerPane, unregisterPane } = useChatPanel();
  // Track the last-registered id so we can unregister the right pane when the
  // descriptor flips to null or the id changes.
  const registeredIdRef = useRef<ChatPaneId | null>(null);

  useEffect(() => {
    if (!descriptor) {
      if (registeredIdRef.current) {
        unregisterPane(registeredIdRef.current);
        registeredIdRef.current = null;
      }
      return undefined;
    }
    registerPane(descriptor);
    registeredIdRef.current = descriptor.id;
    return () => {
      unregisterPane(descriptor.id);
      registeredIdRef.current = null;
    };
  }, [descriptor, registerPane, unregisterPane]);
}

/**
 * Preserve each pane's "first content auto-opens it maximized" behavior. Fires
 * `openPane(id)` exactly on the `hasContent` false→true edge, so new content
 * pulls the panel open the first time it appears — but a later content update
 * (or a user minimizing) never re-grabs focus. Edge detection lives here rather
 * than in the shell so each pane owns its own auto-open trigger.
 */
export function useAutoOpen(id: ChatPaneId, hasContent: boolean) {
  const { openPane } = useChatPanel();
  const prevHadContentRef = useRef(false);

  useEffect(() => {
    const was = prevHadContentRef.current;
    prevHadContentRef.current = hasContent;
    if (hasContent && !was) {
      openPane(id);
    }
  }, [hasContent, id, openPane]);
}
