import {
  useState,
  useEffect,
  useCallback,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from 'react';

interface UseResizableOptions {
  minWidth?: number;
  maxWidth?: number;
  step?: number;
  initialWidth?: number;
  width?: number;
  onWidthChange?: (width: number) => void;
}

const DEFAULT_MIN_WIDTH = 280;
const DEFAULT_MAX_WIDTH = 600;
const DEFAULT_STEP = 20;
const DEFAULT_INITIAL_WIDTH = 384;

export function useResizable(
  panelRef: RefObject<HTMLDivElement | null>,
  options?: UseResizableOptions,
) {
  const minWidth = options?.minWidth ?? DEFAULT_MIN_WIDTH;
  const maxWidth = options?.maxWidth ?? DEFAULT_MAX_WIDTH;
  const resizeStep = options?.step ?? DEFAULT_STEP;

  const isControlled = options?.width !== undefined;
  const [internalWidth, setInternalWidth] = useState(
    options?.initialWidth ?? DEFAULT_INITIAL_WIDTH,
  );
  const width = isControlled ? options.width! : internalWidth;
  const setWidth = useCallback(
    (value: number | ((prev: number) => number)) => {
      if (isControlled && options?.onWidthChange) {
        const next =
          typeof value === 'function' ? value(options.width!) : value;
        options.onWidthChange(next);
      } else {
        setInternalWidth(value);
      }
    },
    [isControlled, options],
  );
  const [isResizing, setIsResizing] = useState(false);

  const handleMouseDown = useCallback((e: ReactMouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const delta = e.key === 'ArrowLeft' ? resizeStep : -resizeStep;
        setWidth((prev) =>
          Math.min(maxWidth, Math.max(minWidth, prev + delta)),
        );
      }
    },
    [resizeStep, minWidth, maxWidth],
  );

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!panelRef.current) return;
      const panelRect = panelRef.current.getBoundingClientRect();
      const newWidth = panelRect.right - e.clientX;
      if (newWidth >= minWidth && newWidth <= maxWidth) {
        setWidth(newWidth);
      }
    };

    const handleMouseUp = () => setIsResizing(false);

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, panelRef, minWidth, maxWidth]);

  return { width, minWidth, maxWidth, handleMouseDown, handleKeyDown };
}
