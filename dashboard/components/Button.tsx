import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost';

const styles: Record<Variant, React.CSSProperties> = {
  primary: {
    background: 'var(--brand)',
    color: '#fff',
    border: '1px solid var(--brand)',
  },
  secondary: {
    background: 'var(--surface)',
    color: 'var(--ink)',
    border: '1px solid var(--border)',
  },
  ghost: {
    background: 'transparent',
    color: 'var(--brand)',
    border: '1px solid transparent',
  },
};

export function Button({
  children,
  variant = 'primary',
  fullWidth,
  style,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  variant?: Variant;
  fullWidth?: boolean;
}) {
  return (
    <button
      type="button"
      {...rest}
      style={{
        minHeight: 44,
        padding: '10px 16px',
        borderRadius: 'var(--radius-btn)',
        fontWeight: 600,
        cursor: rest.disabled ? 'not-allowed' : 'pointer',
        opacity: rest.disabled ? 0.55 : 1,
        width: fullWidth ? '100%' : undefined,
        ...styles[variant],
        ...style,
      }}
    >
      {children}
    </button>
  );
}
