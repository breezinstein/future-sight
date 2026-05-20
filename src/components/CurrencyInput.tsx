import { useEffect, useRef, useState, type InputHTMLAttributes } from 'react';

/**
 * Currency / number input with thousands-separator formatting.
 *
 * Behaviour:
 * - Displays the value with locale thousands separators (e.g. "12,345").
 * - Accepts typing with or without commas; commas are stripped before parsing.
 * - Auto-selects all on focus so users don't have to delete the existing
 *   value (e.g. "0") before typing a new one.
 * - Calls onChange with the parsed numeric value or '' when empty.
 * - Re-syncs display when the parent updates the value externally.
 */
interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
  value: number | '';
  onChange: (value: number | '') => void;
  // Optional currency code shown as a leading badge (e.g. "USD") inside the input.
  currencyHint?: string;
}

export function CurrencyInput({ value, onChange, currencyHint, className = '', ...rest }: Props) {
  const [display, setDisplay] = useState<string>(() =>
    value === '' || value == null ? '' : Number(value).toLocaleString(),
  );

  // Re-sync when the parent value changes externally and we're not in a
  // mid-edit transient state.
  const lastSeen = useRef<number | ''>(value);
  useEffect(() => {
    if (value !== lastSeen.current) {
      lastSeen.current = value;
      setDisplay(value === '' || value == null ? '' : Number(value).toLocaleString());
    }
  }, [value]);

  function handleChange(text: string) {
    const raw = text.replace(/,/g, '');
    if (raw === '' || raw === '-') {
      setDisplay(text);
      onChange('');
      lastSeen.current = '';
      return;
    }
    // Allow trailing "." while typing decimals
    if (raw.endsWith('.') || /^-?\d*\.\d*$/.test(raw)) {
      setDisplay(text);
      const n = Number(raw);
      if (!Number.isNaN(n)) {
        onChange(n);
        lastSeen.current = n;
      }
      return;
    }
    const n = Number(raw);
    if (Number.isNaN(n)) {
      setDisplay(text);
      return;
    }
    setDisplay(n.toLocaleString());
    onChange(n);
    lastSeen.current = n;
  }

  return (
    <div className="relative">
      {currencyHint && (
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-on-surface-variant pointer-events-none tabular">
          {currencyHint}
        </span>
      )}
      <input
        type="text"
        inputMode="decimal"
        value={display}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={() => {
          if (value !== '' && value != null) {
            setDisplay(Number(value).toLocaleString());
          }
        }}
        className={`${className} tabular ${currencyHint ? 'pl-12' : ''}`}
        {...rest}
      />
    </div>
  );
}
