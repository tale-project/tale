'use client';

import { useRef, useState, useEffect, useCallback } from 'react';

const DEFAULT_MIN_ZOOM = 0.5;
const DEFAULT_MAX_ZOOM = 3;
const DEFAULT_ZOOM_STEP = 0.25;
const WHEEL_THROTTLE_MS = 50;
const PAN_KEY_STEP = 50;

interface UseZoomPanOptions {
  minZoom?: number;
  maxZoom?: number;
  zoomStep?: number;
  /**
   * When this value changes, zoom and pan reset to defaults.
   * Pass dialog open state or image src to auto-reset between views.
   */
  resetTrigger?: unknown;
}

interface ZoomPanPointerHandlers {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
}

interface UseZoomPanReturn {
  zoom: number;
  pan: { x: number; y: number };
  isDragging: boolean;
  /** Attach to the scrollable/interactive container element */
  containerRef: React.RefObject<HTMLDivElement | null>;
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
  pointerHandlers: ZoomPanPointerHandlers;
  canZoomIn: boolean;
  canZoomOut: boolean;
  isZoomed: boolean;
  /** Pre-computed CSS transform + transition for the zoomable element */
  transformStyle: React.CSSProperties;
}

export function useZoomPan(options?: UseZoomPanOptions): UseZoomPanReturn {
  const minZoom = options?.minZoom ?? DEFAULT_MIN_ZOOM;
  const maxZoom = options?.maxZoom ?? DEFAULT_MAX_ZOOM;
  const zoomStep = options?.zoomStep ?? DEFAULT_ZOOM_STEP;

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);

  const dragStart = useRef({ x: 0, y: 0 });
  const panStart = useRef({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const lastWheelRef = useRef(0);
  const containerDimsRef = useRef({ width: 0, height: 0 });

  const reset = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  // Reset when trigger changes
  const resetTrigger = options?.resetTrigger;
  useEffect(() => {
    reset();
  }, [resetTrigger, reset]);

  // Cache container dimensions via ResizeObserver for pan clamping
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      containerDimsRef.current = {
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      };
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const zoomInFn = useCallback(() => {
    setZoom((prev) => Math.min(prev + zoomStep, maxZoom));
  }, [zoomStep, maxZoom]);

  const zoomOutFn = useCallback(() => {
    setZoom((prev) => {
      const next = Math.max(prev - zoomStep, minZoom);
      if (next <= 1) setPan({ x: 0, y: 0 });
      return next;
    });
  }, [zoomStep, minZoom]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (zoom <= 1) return;
      e.preventDefault();
      setIsDragging(true);
      dragStart.current = { x: e.clientX, y: e.clientY };
      panStart.current = { x: pan.x, y: pan.y };
      if (e.target instanceof HTMLElement) {
        e.target.setPointerCapture(e.pointerId);
      }
    },
    [zoom, pan],
  );

  const clampPan = useCallback(
    (raw: { x: number; y: number }, currentZoom: number) => {
      const { width, height } = containerDimsRef.current;
      if (width === 0 || height === 0) return raw;
      const maxX = ((currentZoom - 1) * width) / 2;
      const maxY = ((currentZoom - 1) * height) / 2;
      return {
        x: Math.max(-maxX, Math.min(maxX, raw.x)),
        y: Math.max(-maxY, Math.min(maxY, raw.y)),
      };
    },
    [],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging) return;
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;
      const raw = { x: panStart.current.x + dx, y: panStart.current.y + dy };
      setPan(clampPan(raw, zoom));
    },
    [isDragging, zoom, clampPan],
  );

  const handlePointerUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Wheel zoom on the container (throttled)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const now = Date.now();
      if (now - lastWheelRef.current < WHEEL_THROTTLE_MS) return;
      lastWheelRef.current = now;

      if (e.deltaY < 0) {
        setZoom((prev) => Math.min(prev + zoomStep, maxZoom));
      } else {
        setZoom((prev) => {
          const next = Math.max(prev - zoomStep, minZoom);
          if (next <= 1) setPan({ x: 0, y: 0 });
          return next;
        });
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [zoomStep, minZoom, maxZoom]);

  // Keyboard shortcuts on the container
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case '+':
        case '=':
          e.preventDefault();
          setZoom((prev) => Math.min(prev + zoomStep, maxZoom));
          break;
        case '-':
          e.preventDefault();
          setZoom((prev) => {
            const next = Math.max(prev - zoomStep, minZoom);
            if (next <= 1) setPan({ x: 0, y: 0 });
            return next;
          });
          break;
        case '0':
          e.preventDefault();
          setZoom(1);
          setPan({ x: 0, y: 0 });
          break;
        case 'ArrowUp':
        case 'ArrowDown':
        case 'ArrowLeft':
        case 'ArrowRight': {
          setZoom((currentZoom) => {
            if (currentZoom <= 1) return currentZoom;
            e.preventDefault();
            const dx =
              e.key === 'ArrowLeft'
                ? PAN_KEY_STEP
                : e.key === 'ArrowRight'
                  ? -PAN_KEY_STEP
                  : 0;
            const dy =
              e.key === 'ArrowUp'
                ? PAN_KEY_STEP
                : e.key === 'ArrowDown'
                  ? -PAN_KEY_STEP
                  : 0;
            setPan((prev) => {
              const raw = { x: prev.x + dx, y: prev.y + dy };
              const { width, height } = containerDimsRef.current;
              if (width === 0 || height === 0) return raw;
              const maxPanX = ((currentZoom - 1) * width) / 2;
              const maxPanY = ((currentZoom - 1) * height) / 2;
              return {
                x: Math.max(-maxPanX, Math.min(maxPanX, raw.x)),
                y: Math.max(-maxPanY, Math.min(maxPanY, raw.y)),
              };
            });
            return currentZoom;
          });
          break;
        }
      }
    };

    container.addEventListener('keydown', handleKeyDown);
    return () => container.removeEventListener('keydown', handleKeyDown);
  }, [zoomStep, minZoom, maxZoom]);

  const transformStyle: React.CSSProperties = {
    transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
    transformOrigin: 'center center',
    transition: isDragging ? 'none' : 'transform 0.15s ease-out',
  };

  return {
    zoom,
    pan,
    isDragging,
    containerRef,
    zoomIn: zoomInFn,
    zoomOut: zoomOutFn,
    reset,
    pointerHandlers: {
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: handlePointerUp,
      onPointerCancel: handlePointerUp,
    },
    canZoomIn: zoom < maxZoom,
    canZoomOut: zoom > minZoom,
    isZoomed: zoom > 1,
    transformStyle,
  };
}
