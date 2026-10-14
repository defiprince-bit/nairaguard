import { AmountText } from './AmountText';
import type { BalancesResponse } from '../lib/types';

function parseNgn(balances: BalancesResponse['balances']) {
  return balances.reduce((sum, b) => sum + Number(b.amountNgn), 0);
}
function parseUsd(balances: BalancesResponse['balances']) {
  return balances.reduce((sum, b) => sum + Number(b.amountUsd), 0);
}

export function BalanceCard({ data }: { data: BalancesResponse }) {
  const totalNgn = parseNgn(data.balances);
  const totalUsd = parseUsd(data.balances);
  const cngn = data.balances.find((b) => b.token === 'cNGN');
  const usdt = data.balances.find((b) => b.token === 'USDT');
  const ngnPct = data.ngnShareBps / 100;
  const usdPct = 100 - ngnPct;
  const targetPct = data.targetNgnBps / 100;
  const rate = cngn?.rate ?? usdt?.rate;
  const rateAt = cngn?.rateAt ?? usdt?.rateAt;

  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-card)',
        padding: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}
    >
      <div>
        <p className="small" style={{ margin: '0 0 4px', color: 'var(--ink-muted)' }}>
          Total in vault
        </p>
        <AmountText
          amountNgn={totalNgn}
          amountUsd={totalUsd}
          size="display"
          rate={rate ? Number(rate) : undefined}
          rateAt={rateAt ?? undefined}
        />
      </div>

      <div>
        <div
          style={{
            display: 'flex',
            height: 10,
            borderRadius: 999,
            overflow: 'hidden',
            background: 'var(--border)',
          }}
          aria-hidden
        >
          <div style={{ width: `${ngnPct}%`, background: 'var(--brand)' }} />
          <div style={{ width: `${usdPct}%`, background: 'var(--usd)' }} />
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginTop: 8,
            gap: 12,
          }}
        >
          <span className="small" style={{ color: 'var(--brand)', fontWeight: 600 }}>
            cNGN {ngnPct.toFixed(0)}%
            {cngn ? ` · ₦${Number(cngn.amountNgn).toLocaleString('en-NG')}` : ''}
          </span>
          <span className="small" style={{ color: 'var(--usd)', fontWeight: 600 }}>
            USD₮ {usdPct.toFixed(0)}%
            {usdt ? ` · $${Number(usdt.amountUsd).toLocaleString('en-US')}` : ''}
          </span>
        </div>
        <p className="small" style={{ margin: '8px 0 0', color: 'var(--ink-muted)' }}>
          Target mix {targetPct.toFixed(0)}% naira / {(100 - targetPct).toFixed(0)}% dollars
        </p>
      </div>
    </div>
  );
}
