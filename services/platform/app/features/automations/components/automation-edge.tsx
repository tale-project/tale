'use client';

import { useMemo } from 'react';
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
  const [edgePath, defaultLabelX, defaultLabelY] = useMemo(() => {
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
    return getBezierPath({
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
    });
  }, [type, sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition]);

  const { labelX, labelY } = useMemo(() => {
    const labelPosition = data?.labelPosition || 'center';
    let lx = defaultLabelX;
    let ly = defaultLabelY;

    if (labelPosition === 'source') {
      lx = sourceX + (targetX - sourceX) * 0.25;
      ly = sourceY + (targetY - sourceY) * 0.25;
    } else if (labelPosition === 'target') {
      lx = sourceX + (targetX - sourceX) * 0.75;
      ly = sourceY + (targetY - sourceY) * 0.75;
    }

    if (data?.isBackwardConnection) {
      lx += 30;
    }

    if (data?.labelOffset) {
      lx += data.labelOffset.x;
      ly += data.labelOffset.y;
    }

    return { labelX: lx, labelY: ly };
  }, [defaultLabelX, defaultLabelY, sourceX, sourceY, targetX, targetY, data?.labelPosition, data?.isBackwardConnection, data?.labelOffset]);

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
