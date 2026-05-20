import type { ReactNode } from 'react';
import { useDismissible } from '@/hooks/useDismissible';
import { X } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

const SIZE: Record<NonNullable<Props['size']>, string> = {
  sm: 'max-w-md',
  md: 'max-w-xl',
  lg: 'max-w-3xl',
};

export function Modal({ open, onClose, title, children, footer, size = 'md' }: Props) {
  const onBackdrop = useDismissible(open, onClose);
  if (!open) return null;
  return (
    <div
      onClick={onBackdrop}
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 fs-fade-in"
    >
      <div className={`bg-surface-container border border-surface-container-high rounded-lg w-full ${SIZE[size]} shadow-2xl flex flex-col max-h-[90vh]`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-container-high">
          <h2 className="text-lg font-semibold text-on-surface">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-on-surface-variant hover:text-on-surface p-1 -mr-1"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>
        <div className="px-6 py-4 overflow-y-auto flex-1">{children}</div>
        {footer && (
          <div className="px-6 py-4 border-t border-surface-container-high flex items-center justify-end gap-2">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export function SlideOver({ open, onClose, title, children, footer }: Omit<Props, 'size'>) {
  const onBackdrop = useDismissible(open, onClose);
  if (!open) return null;
  return (
    <div
      onClick={onBackdrop}
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm fs-fade-in"
    >
      <div className="absolute right-0 top-0 h-full w-full max-w-xl bg-surface-container border-l border-surface-container-high shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-container-high">
          <h2 className="text-lg font-semibold text-on-surface">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-on-surface-variant hover:text-on-surface p-1 -mr-1"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>
        <div className="px-6 py-4 overflow-y-auto flex-1">{children}</div>
        {footer && (
          <div className="px-6 py-4 border-t border-surface-container-high flex items-center justify-end gap-2">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
