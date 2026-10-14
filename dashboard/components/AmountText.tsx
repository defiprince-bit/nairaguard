'use client';

import { useState } from 'react';

type Size = 'display' | 'h1' | 'h2' | 'body' | 'small';

const sizeClass: Record<Size, string> = {
  display: 'display',
  h1: 'h1',
  h2: 'h2',
  body: '',
  small: 'small',
};

function formatNgn(n: number) {
  return `₦${n.toLocaleString('en-NG', { maximumFractionDigits: 0 })}`;
}

function formatUsd(n: number) {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function AmountText({
  amountNgn,
  amountUsd,
  size = 'body',
  rate,
  rateAt,
}: {
  amountNgn: number;
  amountUsd: number;
  size?: Size;
  rate?: number;
  rateAt?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <button
      type="button"
      className={`tabular ${sizeClass[size]}`}
      onClick={() => setOpen((v) => !v)}
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: 2,
        background: 'none',
        border: 'none',
        padding: 0,
        color: 'inherit',
        cursor: 'pointer',
        textAlign: 'left',
      }}
      aria-expanded={open}
    >
      <span>{formatNgn(amountNgn)}</span>
      <span className="small" style={{ color: 'var(--ink-muted)' }}>
        {formatUsd(amountUsd)}
      </span>
      {open && rate != null && (
        <span className="small" style={{ color: 'var(--ink-muted)' }}>
          Rate ₦{rate.toLocaleString('en-NG')} /$
          {rateAt ? ` · ${rateAt}` : ''}
        </span>
      )}
    </button>
  );
}
