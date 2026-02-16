'use client';

import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';

interface AutomationDetailsCollapseProps {
  context: string;
  title: string;
}

export function AutomationDetailsCollapse({
  context,
  title,
}: AutomationDetailsCollapseProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="border-muted mb-2 overflow-hidden rounded-lg border">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="bg-muted/50 hover:bg-muted flex w-full items-center justify-between px-3 py-2 text-left transition-colors"
      >
        <span className="text-muted-foreground text-xs font-medium">
          {title}
        </span>
        {isOpen ? (
          <ChevronDown className="text-muted-foreground size-3.5" />
        ) : (
          <ChevronRight className="text-muted-foreground size-3.5" />
        )}
      </button>
      {isOpen && (
        <div className="bg-background px-3 py-2">
          <pre className="text-muted-foreground font-mono text-xs whitespace-pre-wrap">
            {context}
          </pre>
        </div>
      )}
    </div>
  );
}
