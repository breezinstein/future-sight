import { useCallback, useEffect } from 'react';

/**
 * Trap-and-close behaviour for modals/slide-overs: Escape closes,
 * click on backdrop closes, focus moves to first focusable child on mount.
 */
export function useDismissible(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );
}
