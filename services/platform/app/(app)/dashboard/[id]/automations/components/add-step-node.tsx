'use client';

import { Handle, Position } from '@xyflow/react';
import { Plus } from 'lucide-react';
import { useT } from '@/lib/i18n';

interface AddStepNodeProps {
  data: {
    onAddStep: () => void;
  };
}

export function AddStepNode({ data }: AddStepNodeProps) {
  const { t } = useT('common');
  return (
    <div className="relative">
      {/* Input Handle */}
      <Handle
        type="target"
        position={Position.Left}
        className="!size-2.5 !bg-muted-foreground"
      />

      <button
        type="button"
        aria-label={t('aria.addStep')}
        className="w-16 h-16 rounded-full border-2 border-dashed border-muted-foreground/50 hover:border-primary/50 hover:bg-primary/10 transition-all cursor-pointer flex items-center justify-center group focus:outline-none focus:ring-2 focus:ring-primary/50"
        onClick={data.onAddStep}
      >
        <Plus className="size-6 text-muted group-hover:text-primary transition-colors" />
      </button>
    </div>
  );
}
