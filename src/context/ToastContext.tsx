import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

export type ToastVariant = 'info' | 'success' | 'warning' | 'error';

interface Toast {
  id: number;
  message: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  show: (message: string, variant?: ToastVariant) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const show = useCallback((message: string, variant: ToastVariant = 'info') => {
    const id = nextId++;
    setToasts((prev) => [...prev, { id, message, variant }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, variant === 'error' ? 6000 : 3500);
  }, []);

  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Toasts sit at the top of the viewport so they don't overlap action
          buttons that tend to live at the bottom of cards. pointer-events:none
          on the toast itself (not just the container) means they never block
          a click on what's underneath. */}
      <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-2 pointer-events-none w-full max-w-md px-4">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`fs-fade-in pointer-events-none px-4 py-2.5 rounded-lg border shadow-lg backdrop-blur-sm bg-opacity-90
              ${variantStyles[t.variant]}`}
          >
            <p className="text-sm">{t.message}</p>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

const variantStyles: Record<ToastVariant, string> = {
  info: 'bg-surface-container border-outline-variant text-on-surface',
  success: 'bg-surface-container border-secondary/40 text-secondary',
  warning: 'bg-surface-container border-tertiary/40 text-tertiary',
  error: 'bg-surface-container border-error/40 text-error',
};

// eslint-disable-next-line react-refresh/only-export-components
export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
