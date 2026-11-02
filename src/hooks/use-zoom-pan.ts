'use client';

import { useRef, useState, useEffect, useCallback } from 'react';

const DEFAULT_MIN_ZOOM = 0.5;
// 5x covers reading screenshots / fine UI at native pixels on a typical
// retina display. Beyond ~5x the image's source resolution usually starts
// to look pixelated, so going higher isn't helpful.
const DEFAULT_MAX_ZOOM = 5;
const DEFAULT_ZOOM_STEP = 0.25;
// Where double-click lands on the first zoom-in. 2x is the universal
// "tap to zoom" target (maps/lightboxes/etc.) and leaves plenty of headroom
// to keep zooming with the wheel/+ key afterward.
const DEFAULT_DOUBLE_CLICK_ZOOM = 2;
const WHEEL_THROTTLE_MS = 50;
const PAN_KEY_STEP = 50;

interface UseZoomPanOptions {
  minZoom?: number;
  maxZoom?: number;
  zoomStep?: number;
  /** Target zoom level applied by `toggleZoom` when starting from 1x. */
  doubleClickZoom?: number;
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
  /**
   * Toggle between 1x and `doubleClickZoom`. When zooming in, pass the
   * client-space point under the cursor (`e.clientX/Y`) so the image is
   * anchored to that point instead of the container center — the pixel
   * under the cursor stays put as the image grows around it, which is what
   * users expect from a double-click. When zooming out, the argument is
   * ignored.
   */
  toggleZoom: (clientPoint?: { x: number; y: number }) => void;
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
  const doubleClickZoom = Math.min(
    options?.doubleClickZoom ?? DEFAULT_DOUBLE_CLICK_ZOOM,
    maxZoom,
  );

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
    if (!el) return undefined;
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

  /**
   * Adjust pan so the content under a given screen-space point stays fixed
   * while the zoom level changes — the "anchor zoom" behavior users expect
   * from wheel and double-click. Math: the transform is
   * `scale(z) translate(pan/z)` with `transform-origin: center`, so a screen
   * offset `o` from the container center maps to content coord `(o - pan) / z`.
   * Solving for the new pan that keeps that content coord under the same
   * screen offset after zoom change z0 → z1 gives:
   *   panNew = o * (1 - z1/z0) + panOld * (z1/z0)
   */
  const zoomToward = useCallback(
    (
      nextZoom: number,
      clientPoint: { x: number; y: number } | undefined,
      prevZoom: number,
      prevPan: { x: number; y: number },
    ) => {
      const container = containerRef.current;
      if (!container || !clientPoint || nextZoom <= 1) {
        // No anchor, or we're going back to fit — pan resets to 0 either way
        // (clampPan would force it there next render).
        return nextZoom <= 1 ? { x: 0, y: 0 } : prevPan;
      }
      const rect = container.getBoundingClientRect();
      const offsetX = clientPoint.x - (rect.left + rect.width / 2);
      const offsetY = clientPoint.y - (rect.top + rect.height / 2);
      const ratio = nextZoom / prevZoom;
      const raw = {
        x: offsetX * (1 - ratio) + prevPan.x * ratio,
        y: offsetY * (1 - ratio) + prevPan.y * ratio,
      };
      return clampPan(raw, nextZoom);
    },
    [clampPan],
  );

  const toggleZoom = useCallback(
    (clientPoint?: { x: number; y: number }) => {
      setZoom((prev) => {
        if (prev > 1) {
          setPan({ x: 0, y: 0 });
          return 1;
        }
        const next = doubleClickZoom;
        setPan((prevPan) => zoomToward(next, clientPoint, prev, prevPan));
        return next;
      });
    },
    [doubleClickZoom, zoomToward],
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
    if (!container) return undefined;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const now = Date.now();
      if (now - lastWheelRef.current < WHEEL_THROTTLE_MS) return;
      lastWheelRef.current = now;

      // Capture the cursor point on the wheel event so the pan adjust keeps
      // whatever's under the pointer fixed as the image grows/shrinks. Center-
      // anchored zoom (the old behavior) yanks the visible region away from
      // wherever the user is looking.
      const point = { x: e.clientX, y: e.clientY };
      const direction = e.deltaY < 0 ? 1 : -1;

      setZoom((prev) => {
        const next =
          direction > 0
            ? Math.min(prev + zoomStep, maxZoom)
            : Math.max(prev - zoomStep, minZoom);
        if (next === prev) return prev;
        if (next <= 1) {
          setPan({ x: 0, y: 0 });
        } else {
          setPan((prevPan) => zoomToward(next, point, prev, prevPan));
        }
        return next;
      });
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [zoomStep, minZoom, maxZoom, zoomToward]);

  // Keyboard shortcuts on the container
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

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
    toggleZoom,
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
