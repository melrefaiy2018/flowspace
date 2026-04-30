import { useCallback, useEffect, useRef, useState } from 'react';

interface Options {
  storageKey: string;
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
  /** Pixel step used when arrow keys resize the pane while the handle is focused. */
  keyboardStep?: number;
}

interface Result {
  width: number;
  isDragging: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onDoubleClick: () => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function readInitialWidth(key: string, fallback: number, min: number, max: number): number {
  if (typeof localStorage === 'undefined') return fallback;
  const raw = localStorage.getItem(key);
  if (raw === null) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return clamp(parsed, min, max);
}

export function useResizablePane({
  storageKey,
  defaultWidth,
  minWidth,
  maxWidth,
  keyboardStep = 16,
}: Options): Result {
  const [width, setWidth] = useState(() => readInitialWidth(storageKey, defaultWidth, minWidth, maxWidth));
  const [isDragging, setIsDragging] = useState(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(width);

  const persist = useCallback((next: number) => {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(storageKey, String(next));
  }, [storageKey]);

  const setClampedWidth = useCallback((next: number) => {
    const clamped = clamp(next, minWidth, maxWidth);
    setWidth(clamped);
    return clamped;
  }, [minWidth, maxWidth]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    startXRef.current = e.clientX;
    startWidthRef.current = width;
    setIsDragging(true);
  }, [width]);

  useEffect(() => {
    if (!isDragging) return;

    const handleMove = (e: MouseEvent) => {
      const delta = e.clientX - startXRef.current;
      setClampedWidth(startWidthRef.current + delta);
    };

    const handleUp = () => {
      setIsDragging(false);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    const prevCursor = document.body.style.cursor;
    const prevSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevSelect;
    };
  }, [isDragging, setClampedWidth]);

  useEffect(() => {
    if (isDragging) return;
    persist(width);
  }, [isDragging, width, persist]);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setClampedWidth(width - keyboardStep);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      setClampedWidth(width + keyboardStep);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setClampedWidth(minWidth);
    } else if (e.key === 'End') {
      e.preventDefault();
      setClampedWidth(maxWidth);
    }
  }, [width, keyboardStep, setClampedWidth, minWidth, maxWidth]);

  const onDoubleClick = useCallback(() => {
    setClampedWidth(defaultWidth);
  }, [setClampedWidth, defaultWidth]);

  return { width, isDragging, onMouseDown, onKeyDown, onDoubleClick };
}
