'use client';

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';

/**
 * Шесть ячеек кода: мгновенная вставка, автопереход фокуса, анимация заполнения.
 * Компонент контролируемый — цифры живут у родителя, чтобы он мог отправить код
 * на проверку ровно в тот момент, когда он стал полным.
 */
type Props = {
  length?: number;
  value: string;
  onChange: (digits: string) => void;
  /** digits — то, что легло в ячейки; raw — все цифры из буфера (могут быть длиннее ячеек). */
  onComplete?: (digits: string, raw: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  autoFocus?: boolean;
  focusKey?: number;
  label?: string;
  reducedMotion?: boolean;
};

const digitsOnly = (text: string) => text.replace(/\D+/g, '');

export default function OtpCodeInput({
  length = 6,
  value,
  onChange,
  onComplete,
  disabled = false,
  invalid = false,
  autoFocus = true,
  focusKey = 0,
  label,
  reducedMotion = false,
}: Props) {
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const [active, setActive] = useState(-1);
  const cells = Array.from({ length }, (_, index) => value[index] ?? '');

  const focusCell = (index: number) => {
    const target = inputs.current[Math.max(0, Math.min(length - 1, index))];
    target?.focus();
    target?.select();
  };

  useEffect(() => {
    if (!autoFocus) return;
    const id = requestAnimationFrame(() => focusCell(digitsOnly(value).length >= length ? 0 : digitsOnly(value).length));
    return () => cancelAnimationFrame(id);
    // focusKey меняется после ошибки — фокус возвращается в первую ячейку.
  }, [autoFocus, focusKey, length]);

  const fill = (raw: string, from: number, pasted: boolean) => {
    const digits = digitsOnly(raw);
    if (!digits) {
      if (!pasted) onChange('');
      return;
    }
    // Вставка полного кода раскладывается с первой ячейки, частичная — от текущей.
    const merged = pasted && digits.length >= length ? digits.slice(0, length) : (value.slice(0, from) + digits).slice(0, length);
    onChange(merged);
    if (pasted && digits.length >= length) {
      focusCell(length - 1);
      onComplete?.(merged, digits.slice(0, 12));
      return;
    }
    focusCell(merged.length >= length ? length - 1 : merged.length);
    if (merged.length === length) onComplete?.(merged, merged);
  };

  return (
    <motion.div
      className="otp-row"
      animate={invalid && !reducedMotion ? { x: [0, -10, 10, -7, 7, 0] } : { x: 0 }}
      transition={{ duration: 0.42, ease: 'easeInOut' }}
      role="group"
      aria-label={label}
    >
      {cells.map((digit, index) => (
        <motion.div
          key={index}
          className={`otp-cell${digit ? ' is-filled' : ''}${active === index ? ' is-active' : ''}${invalid ? ' is-invalid' : ''}`}
          initial={false}
          animate={digit && !reducedMotion ? { scale: [1.18, 1], y: [-3, 0] } : { scale: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 520, damping: 26 }}
        >
          <input
            ref={(element) => { inputs.current[index] = element; }}
            value={digit}
            onChange={(event) => fill(event.target.value, index, false)}
            onKeyDown={(event) => {
              if (event.key === 'Backspace') {
                event.preventDefault();
                if (value[index]) onChange((value.slice(0, index) + value.slice(index + 1)).slice(0, length));
                else focusCell(index - 1);
              } else if (event.key === 'ArrowLeft') { event.preventDefault(); focusCell(index - 1); }
              else if (event.key === 'ArrowRight') { event.preventDefault(); focusCell(index + 1); }
            }}
            onPaste={(event) => {
              event.preventDefault();
              fill(event.clipboardData.getData('text'), index, true);
            }}
            onFocus={(event) => { setActive(index); event.target.select(); }}
            onBlur={() => setActive(-1)}
            inputMode="numeric"
            autoComplete={index === 0 ? 'one-time-code' : 'off'}
            pattern="[0-9]*"
            maxLength={length}
            disabled={disabled}
            aria-label={`Цифра ${index + 1}`}
          />
        </motion.div>
      ))}
    </motion.div>
  );
}
