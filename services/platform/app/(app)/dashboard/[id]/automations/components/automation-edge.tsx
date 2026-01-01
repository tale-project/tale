'use client';

import {
  BaseEdge,
  EdgeLabelRenderer,
  EdgeProps,
  getSmoothStepPath,
  getBezierPath,
  getStraightPath,
} from '@xyflow/react';

interface AutomationEdgeProps extends EdgeProps {
  type?: 'smoothstep' | 'bezier' | 'straight' | 'default';
  data?: {
    label?: string;
    labelStyle?: {
      fill?: string;
      fontSize?: string;
      fontWeight?: number;
    };
    labelBgStyle?: {
      fill?: string;
      stroke?: string;
      strokeWidth?: number;
    };
    // Smart label positioning options
    labelPosition?: 'center' | 'source' | 'target'; // Position along edge
    labelOffset?: { x: number; y: number }; // Manual offset from calculated position
    isBackwardConnection?: boolean; // For special handling of backward edges
  };
}

export function AutomationEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  data,
  type = 'smoothstep',
}: AutomationEdgeProps) {
  // Use appropriate path function based on edge type
  const [edgePath, defaultLabelX, defaultLabelY] = (() => {
    if (type === 'smoothstep' || type === 'default') {
      return getSmoothStepPath({
        sourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition,
      });
    }
    if (type === 'straight') {
      return getStraightPath({
        sourceX,
        sourceY,
        targetX,
        targetY,
      });
    }
    // bezier (or fallback)
    return getBezierPath({
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
    });
  })();

  // Calculate smart label position
  const calculateLabelPosition = () => {
    const labelPosition = data?.labelPosition || 'center';
    let labelX = defaultLabelX;
    let labelY = defaultLabelY;

    // Adjust position based on labelPosition setting
    if (labelPosition === 'source') {
      // Position label 25% from source
      labelX = sourceX + (targetX - sourceX) * 0.25;
      labelY = sourceY + (targetY - sourceY) * 0.25;
    } else if (labelPosition === 'target') {
      // Position label 75% toward target
      labelX = sourceX + (targetX - sourceX) * 0.75;
      labelY = sourceY + (targetY - sourceY) * 0.75;
    }

    // Special handling for backward connections
    if (data?.isBackwardConnection) {
      // Offset label to the side for backward connections to avoid overlap
      const offsetX = 30; // Offset to the right
      labelX += offsetX;
    }

    // Apply manual offset if provided
    if (data?.labelOffset) {
      labelX += data.labelOffset.x;
      labelY += data.labelOffset.y;
    }

    return { labelX, labelY };
  };

  const { labelX, labelY } = calculateLabelPosition();

  return (
    <>
      <g>
        <BaseEdge
          path={edgePath}
          markerEnd={markerEnd}
          style={{
            ...style,
            strokeWidth: (style.strokeWidth as number) || 2,
            stroke: style.stroke as string,
          }}
        />
      </g>
      <EdgeLabelRenderer>
        {/* Static label - always visible if provided */}
        {data?.label && (
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'none',
              zIndex: -1, // Below nodes (nodes are at z-index 0 or higher)
              padding: '0px 6px',
              borderRadius: '4px',
              backgroundColor:
                data.labelBgStyle?.fill || 'hsl(var(--background))',
              border: data.labelBgStyle?.stroke
                ? `${data.labelBgStyle.strokeWidth || 1}px solid ${data.labelBgStyle.stroke}`
                : 'none',
              color: data.labelStyle?.fill || 'hsl(var(--foreground))',
              fontSize: data.labelStyle?.fontSize || '11px',
              fontWeight: data.labelStyle?.fontWeight || 600,
            }}
          >
            {data.label}
          </div>
        )}
      </EdgeLabelRenderer>
    </>
  );
}
