'use client';

import { useEffect, useMemo, useState } from 'react';
import s from './LimitsScreen.module.css';
import { ErrorBanner } from './ErrorBanner';
import { InlineMessage } from './InlineMessage';
import { Skeleton } from './Skeleton';
import { getJson } from '../lib/overview';
import type { ApiLimits } from '../lib/overviewView';
import { ringDash } from '../lib/overviewView';
import { classifyError, MSG_TIMEOUT, type FriendlyError } from '../lib/errors';
import { DEFAULT_PRESET, PRESETS, type PresetId } from '../lib/vault';
import { formFromApi, formFromPreset, matchPreset, sameForm, sendSetLimits, toLimits, validateLimits, type LimitsForm } from '../lib/limits';

const COPY: Record<PresetId | 'custom', string> = {
  careful: 'Small, slow moves. Asks you before almost anything.',
  balanced: 'Steady protection for everyday savings.',
  active: 'Bigger moves when the naira shifts. Still within your limits.',
  custom: 'Your own numbers. Slippage stays at your current setting.',
};
const IDS = Object.keys(PRESETS) as PresetId[];
type Note = FriendlyError | { kind: 'pending'; message: string } | { kind: 'ok'; message: string };

export function LimitsScreen({ owner, vault }: { owner: `0x${string}`; vault: `0x${string}` }) {
  const [saved, setSaved] = useState<LimitsForm | null>(null);
  const [form, setForm] = useState<LimitsForm | null>(null);
  const [picked, setPicked] = useState<PresetId | 'custom'>(DEFAULT_PRESET);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note | null>(null);
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  async function load(): Promise<LimitsForm | null> {
    setLoadErr(null);
    try {
      const r = await getJson<ApiLimits>(`vault/${vault.toLowerCase()}/limits`);
      if (!r.ok || !r.data) throw new Error('unavailable');
      const f = formFromApi(r.data);
      setSaved(f); setForm(f); setPicked(matchPreset(f)); setTouched({});
      return f;
    } catch {
      setLoadErr('Could not load your limits. Try again.');
      return null;
    }
  }
  useEffect(() => { void load(); }, [vault]); // eslint-disable-line react-hooks/exhaustive-deps

  const errors = useMemo(() => (form ? validateLimits(form) : {}), [form]);
  const valid = Object.keys(errors).length === 0;
  const changed = !!form && !!saved && !sameForm(form, saved);

  function pick(id: PresetId) {
    if (!form) return;
    setForm(formFromPreset(id, form.targetPct)); setPicked(id); setNote(null);
  }
  function edit(k: 'maxTrade' | 'maxDaily' | 'askAbove', v: string) {
    if (!form) return;
    setForm({ ...form, [k]: v }); setPicked('custom'); setNote(null);
  }

  async function save() {
    if (!form || !valid || !changed) return;
    setBusy(true);
    setNote({ kind: 'pending', message: 'Confirm in your wallet…' });
    try {
      await sendSetLimits(owner, vault, toLimits(form));
      await load(); // show what the chain/agent now reports, not what was typed
      setNote({ kind: 'ok', message: 'Limits saved. The agent uses them from its next check.' });
    } catch (e) {
      const f = classifyError(e);
      setNote(f.message === MSG_TIMEOUT ? { kind: 'pending', message: 'Still confirming… ' + MSG_TIMEOUT.replace(/^Still confirming on the network\. /, '') } : f);
    } finally {
      setBusy(false);
    }
  }

  if (loadErr && !form) return <ErrorBanner message={loadErr} onRetry={() => void load()} />;
  if (!form) return <div className={s.wrap}><Skeleton height={420} /><Skeleton height={420} /></div>;

  const ngn = form.targetPct, usd = 100 - ngn;
  const fmt = (v: string) => `$${Number(v.replace(/,/g, '') || 0).toLocaleString('en-US')}`;
  const field = (k: 'maxTrade' | 'maxDaily' | 'askAbove', label: string, hint: string) => {
    const err = touched[k] || picked === 'custom' ? errors[k] : undefined;
    return (
      <div className={s.field}>
        <label htmlFor={`lim-${k}`}>{label}</label>
        <div className={s.inBox} data-bad={!!err}>
          <span aria-hidden>$</span>
          <input id={`lim-${k}`} inputMode="decimal" autoComplete="off" value={form[k]}
            aria-invalid={!!err} aria-describedby={`lim-${k}-h${err ? ` lim-${k}-e` : ''}`}
            onChange={(e) => edit(k, e.target.value)} onBlur={() => setTouched((t) => ({ ...t, [k]: true }))} />
        </div>
        <span id={`lim-${k}-h`} className={s.hint}>{hint}</span>
        {err ? <p id={`lim-${k}-e`} className={s.err} role="alert">{err}</p> : null}
      </div>
    );
  };

  return (
    <div className={s.wrap}>
      <section className={s.card} aria-labelledby="lim-guard">
        <h2 id="lim-guard">How careful is your agent?</h2>
        <p className={s.sub}>Pick a style, or set your own numbers.</p>
        <div className={s.seg} role="radiogroup" aria-label="Limit style">
          {IDS.map((id) => (
            <button key={id} type="button" role="radio" aria-checked={picked === id} onClick={() => pick(id)} disabled={busy}>
              {PRESETS[id].label}
            </button>
          ))}
          <button type="button" role="radio" aria-checked={picked === 'custom'} className={s.customOn} disabled
            title="Edit any amount to switch to Custom">Custom</button>
        </div>
        <p className={s.blurb} aria-live="polite">{COPY[picked]}</p>
        {field('maxTrade', 'Max per trade', 'The biggest single swap the agent can make.')}
        {field('maxDaily', 'Daily max', 'Total the agent can swap in a day.')}
        {field('askAbove', 'Ask me above', 'Trades bigger than this wait for your OK.')}
        <div className={s.ro} aria-label="Slippage">
          <span>Max price slippage</span><b>{(form.slippageBps / 100).toLocaleString('en-US')}%</b>
        </div>
      </section>

      <section className={s.card} aria-labelledby="lim-mix">
        <h2 id="lim-mix">Target mix</h2>
        <p className={s.sub}>The agent nudges your savings back toward this split.</p>
        <div className={s.mixRow}>
          <svg className={s.ring} width="84" height="84" viewBox="0 0 84 84" aria-hidden>
            <circle cx="42" cy="42" r="34" fill="none" stroke="var(--usd)" strokeOpacity=".75" strokeWidth="12" />
            <circle cx="42" cy="42" r="34" fill="none" stroke="var(--brand)" strokeWidth="12" strokeLinecap={ngn > 0 && ngn < 100 ? 'round' : 'butt'}
              strokeDasharray={ringDash(ngn, 34)} transform="rotate(-90 42 42)" />
          </svg>
          <div>
            <label htmlFor="lim-target" className={s.hint} style={{ fontSize: 13 }}>How much stays in naira</label>
            <div className={s.mixLabel} aria-live="polite">{ngn}% naira · <em>{usd}% dollars</em></div>
          </div>
        </div>
        <input id="lim-target" className={s.range} type="range" min={0} max={100} step={5} value={ngn} disabled={busy}
          aria-valuetext={`${ngn}% naira, ${usd}% dollars`}
          onChange={(e) => { setForm({ ...form, targetPct: Number(e.target.value) }); setNote(null); }} />
        <div className={s.ends}><span>All dollars</span><span>All naira</span></div>
        <div className={s.bar} aria-hidden><i style={{ width: `${ngn}%` }} /><u /></div>
        <h2 style={{ fontSize: 17 }}>How your agent behaves</h2>
        <ul className={s.how}>
          <li>Keeps about <b>{ngn}% in naira</b> and <b>{usd}% in USD₮</b>, swapping when the mix drifts.</li>
          <li>Swaps up to <b>{fmt(form.maxTrade)}</b> at a time and <b>{fmt(form.maxDaily)}</b> a day.</li>
          <li>Asks you first for anything above <b>{fmt(form.askAbove)}</b>.</li>
          <li>Skips a trade if the price moves more than <b>{(form.slippageBps / 100).toLocaleString('en-US')}%</b>.</li>
        </ul>
      </section>

      {note || loadErr ? (
        <div className={s.msgs}>
          {loadErr ? <ErrorBanner message={loadErr} onRetry={() => void load()} /> : null}
          {note ? <InlineMessage err={note.kind === 'ok' ? { kind: 'cancelled', message: note.message } : note}
            onDismiss={busy ? undefined : () => setNote(null)} /> : null}
        </div>
      ) : null}

      <div className={s.save}>
        <button type="button" className={s.saveBtn} disabled={!changed || !valid || busy} onClick={() => void save()}>
          {busy ? 'Saving…' : changed ? 'Save limits' : 'No changes'}
        </button>
      </div>
    </div>
  );
}
