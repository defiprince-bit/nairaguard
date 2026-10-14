# NairaGuard UI spec

Build spec for Cursor. The dashboard and waitlist are one Next.js app in `dashboard/`, designed mobile-first to run inside **MiniPay** (an in-app browser that needs HTTPS and injects a wallet provider). Data shapes come from `docs/design.md`; if they differ, `design.md` wins.

## 1. Principles
- Mobile-first: design at 360×640, max content width 480px, centred on desktop.
- Plain English: every agent action has a one-sentence reason. Avoid jargon like "slippage" in primary text.
- Always show money in ₦ first and $ second, e.g. `₦812,400 · $512.30`.
- Users never get a separate login. Inside MiniPay, connect the injected wallet automatically. In a normal browser, show a "Connect wallet" button.
- Fees are paid in stablecoin. Never ask users for CELO.

## 2. Design tokens
Colours (Tailwind or CSS variables):
| Token | Value | Use |
|---|---|---|
| `--bg` | `#F7F8F5` | page background |
| `--surface` | `#FFFFFF` | cards |
| `--ink` | `#14201A` | main text |
| `--ink-muted` | `#5B6B62` | secondary text |
| `--brand` | `#0E7A4F` | primary actions, naira green |
| `--brand-soft` | `#E3F2EA` | brand tints |
| `--usd` | `#2F5BD3` | USD₮ accents |
| `--warn` | `#B26A00` / soft `#FFF3E0` | pending, expiring |
| `--danger` | `#C4352B` / soft `#FDECEA` | failed, limit hit |
| `--border` | `#E4E8E3` | dividers |

Type uses the system font stack (fast inside MiniPay), with tabular numbers for all amounts (`font-variant-numeric: tabular-nums`).
| Role | Size/line height | Weight |
|---|---|---|
| Display (total balance) | 32/38 | 700 |
| H1 | 22/28 | 700 |
| H2 | 17/24 | 600 |
| Body | 15/22 | 400 |
| Small | 13/18 | 400 |

Spacing uses a 4px scale (4, 8, 12, 16, 24, 32). Card radius is 16px, button radius 12px. Tap targets are at least 44px tall.

## 3. Components
- **AmountText**: shows ₦ with $ underneath or after it. The props are `amountNgn`, `amountUsd`, `size`. Tapping it shows the rate used and its timestamp.
- **BalanceCard**: the total value, a cNGN/USD₮ split bar, and the target mix.
- **TradeRow**: direction icon, "Swapped ₦X → $Y", reason (2 lines, then expand), time, and status chip. Tapping it opens the tx on Celoscan.
- **StatusChip**: `pending` (warn), `executed` (brand), `failed` (danger), `expired` (muted).
- **ApprovalCard**: the trade summary, reason, a countdown to `expiresAt`, and Approve (primary) and Reject (secondary) buttons. After expiry the buttons are disabled and the chip shows "expired".
- **LimitField**: a labelled ₦ input with the current value and helper text.
- **BottomNav**: Overview, Activity, Approvals (with a badge count), Limits.
- **EmptyState**, **Skeleton**, **ErrorBanner** (with a Retry button).

## 4. Screens
Every screen has loading (skeletons), empty, error (banner and retry), and loaded states.

### 4.1 Waitlist (`/`, unauthenticated) — due 21 Oct
1. Headline: "Stop losing money when the naira moves."
2. Sub: "An AI agent on Celo that moves your savings between cNGN and USD₮ within limits you set, and explains every trade in plain English."
3. Loss example card: "₦500,000 held in naira lost about ₦{lossNgn} when the rate moved last month." `{lossNgn}` comes from Architecture's rate script. **Never ship a placeholder**: hide the card if the value is missing.
4. Form: email or phone (one field, detect which), plus a consent checkbox. The wallet field depends on context:
   - Inside MiniPay: fill it from the injected provider, show it read-only, and label it "verified".
   - In other browsers: an optional text field, stored as "unverified".
5. CTA: "Join the waitlist", with "Works right inside MiniPay" underneath.
6. Read `?source=` from the URL and send it with the signup.
7. Success state: "You're on the list," plus a share link that keeps the source.

### 4.2 Overview (`/app`)
A BalanceCard at the top, then an agent status line ("Agent active · last check 2 min ago", or a warning if it's stale for more than 15 min), then the 3 latest TradeRows with "See all", and a pending approvals banner when there are any.

### 4.3 Activity (`/app/activity`)
A reverse-chronological list of TradeRows grouped by day, filterable by All, Executed, Pending and Failed, with infinite scroll.

### 4.4 Approvals (`/app/approvals`)
A list of ApprovalCards, soonest expiry first. Approving signs through the wallet, and every tx goes through the shared tx builder, which adds the attribution tag. Show "Waiting for wallet…" and then a success or failure toast.

### 4.5 Limits (`/app/limits`)
Fields for the max per trade, max per day, approval threshold (trades above it need approval), and target mix (a cNGN/USD₮ slider). Saving needs a wallet signature. Show a summary like "The agent can trade up to ₦X per day; anything over ₦Y needs your approval."

## 5. MiniPay specifics
- Detect MiniPay with `window.ethereum?.isMiniPay`. Connect without a button prompt.
- Hide "Connect wallet" and any network switching inside MiniPay.
- Test every PR on its HTTPS preview URL inside MiniPay on a real phone.
- Keep the first-load JS small. Avoid heavy chart libraries and use a simple SVG for the split bar.

## 6. Accessibility
Text contrast is at least 4.5:1. Never use colour alone for status, so chips carry text too. Inputs have labels, and countdowns have an `aria-live="polite"` text equivalent.

## 7. Build order for Cursor
1. Tokens and base components (AmountText, StatusChip, buttons, skeletons).
2. The waitlist page and signup API call (due 21 Oct).
3. Wallet connection, including MiniPay auto-connect.
4. Overview, then Activity, Approvals and Limits.
5. A polish pass of empty and error states plus a real-device check in MiniPay.
