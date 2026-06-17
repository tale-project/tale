'use client';

import { memo } from 'react';

interface MessageArtifactPillsProps {
  organizationId: string;
  threadId: string;
  messageId: string;
}

// Artifact pills retired with the artifacts module — workspace files now
// surface via the right-pane workspace sidebar.
function MessageArtifactPillsComponent(_props: MessageArtifactPillsProps) {
  return null;
}

export const MessageArtifactPills = memo(MessageArtifactPillsComponent);
