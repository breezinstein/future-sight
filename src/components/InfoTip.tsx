import { useState, useRef, useEffect } from 'react';
import { Info } from 'lucide-react';

interface Props {
  label?: string;
  children: React.ReactNode;
  className?: string;
}

export function InfoTip({ label, children, className = '' }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  return (
    <span ref={ref} className={`relative inline-flex items-center ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={label ? `What is ${label}?` : 'More info'}
        className="inline-flex items-center justify-center w-4 h-4 ml-1 rounded-full text-on-surface-variant hover:text-primary transition-colors align-middle"
      >
        <Info size={12} />
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute z-50 left-1/2 -translate-x-1/2 top-full mt-1 w-64 fs-card p-3 text-xs text-on-surface-variant normal-case tracking-normal font-normal shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          {children}
        </span>
      )}
    </span>
  );
}
