import { useEffect, useRef, useState } from "react";

export function useDelayedLoading(loading: boolean, delayMs = 150, minimumMs = 300): boolean {
  const [visible, setVisible] = useState(false);
  const shownAt = useRef(0);
  useEffect(() => {
    let timer: number | undefined;
    if (loading) {
      timer = window.setTimeout(() => {
        shownAt.current = Date.now();
        setVisible(true);
      }, delayMs);
    } else if (visible) {
      timer = window.setTimeout(() => setVisible(false), Math.max(0, minimumMs - (Date.now() - shownAt.current)));
    } else {
      setVisible(false);
    }
    return () => { if (timer !== undefined) window.clearTimeout(timer); };
  }, [loading, delayMs, minimumMs, visible]);
  return visible;
}

export function useDebouncedValue<T>(value: T, delayMs = 70): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
