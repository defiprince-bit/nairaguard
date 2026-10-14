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

**Bento overview tokens (v2, `globals.css`):** `--bg-app #eef1ef`, `--ink-strong #0b1f17` (dark pills, nav, approval banner), `--forest #0b4a30`, `--brand #0e7a4f`, `--mint #7cf2c1`, `--mint-2 #9bf7c9`, `--lime #b6f56a`, `--lime-glow #c8ff7a` (savings card gradient, countdown), `--ink-faint #9aa7a1` (grey decimals), `--line #d9e1dd`, `--tile #f5f7f6`, `--tile-2 #f1f4f2`, `--dark-muted #9fb5ab`, `--dark-line #2d4238`, `--badge #ff6b4a`, `--loss #d64545`, `--radius-bento 24px`, `--shadow-bento`. Logo v2 (`/icon-v2.svg`, `/logo-v2.svg`) uses only these hexes.

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

## Task 8b UI (approval window, venue, reference feed)

- **Approvals** (`status` from `GET /vault/:a/approvals`): Approving calls `Vault.approve(id)`, which opens a **30-minute window**; it does not trade immediately. Helper under the buttons: "Approving gives the agent 30 minutes to trade at your limit or better. If the price never gets there, nothing trades."
  - `pending`: "Swap ~$X to USD₮ · at ₦<floor>/$ or better" (floor from `approvedMinOut`/`minOut` vs the input leg), countdown, Approve/Reject.
  - `approved`: chip "Approved", "Approved · trading within <countdown> at ₦<floor>/$ or better" (countdown from `expiresAt`, which is the window end).
  - `executed`: "Traded at ₦<rate>/$" + explorer link (`executedTx`).
  - `expired` after approval: "Didn't trade, price never reached your limit" (neutral grey, never an error). Expired before approval: "Expired, nothing was traded".
  - `rejected`: unchanged.
  - The Overview banner uses the same lines; pending first, approved shows the window countdown with no buttons.
- **Activity**: confirmed swaps show a small line from `venue`: "via Textile FX" (`textile`), "via Celo pool" (pool labels), else "via <label>". On Sepolia (`NEXT_PUBLIC_NETWORK != celo`) it reads "Test swap (mock exchange)". Quote outcomes shown quietly in grey: `price_moved` → "Price moved, didn't trade"; `no_quote` → "No offer from the exchange right now. Will try again next check."
- **Overview**: "Naira rate today" stays the tradable rate. Tapping it reveals "Official rate ₦<feedRate>/$ · updated N min ago" from `/status`. Agent card: `paused: "stale_price"` → "Paused, waiting for a fresh naira price."; `paused: "owner"` → "Paused by you…".
- **Limits** (when the per-trade input lands): hint "Smallest trade is about $1." with `perTradeError` validation in `lib/format.ts`.

## Outside MiniPay: connect sheet (any browser)

- **Inside MiniPay** (`window.ethereum.isMiniPay`): unchanged. Auto-connect, join-only waitlist, no SIWE, no wallet menu, no fee hint.
- **Elsewhere**, "Connect wallet" opens a **bottom sheet** (mobile, grab handle, 24px top radius) or a **centred modal** (≥768px, 24px radius). Rows are pill buttons (`--tile`, `--line`, 999px radius):
  1. **Valora**: uses an injected Valora provider if one is detected, otherwise WalletConnect ("Scan with the Valora app"). Hidden when neither is available.
  2. **MetaMask / browser wallet**: one row per EIP-6963 wallet (name + icon), falling back to `window.ethereum`. Disabled with "No browser wallet found" when there are none.
  3. **WalletConnect**: QR modal. Shown only when `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` is set; the SDK is lazy-loaded on tap.
  - Footer: "On your phone? Open NairaGuard inside MiniPay for one-tap setup." `/app?connect=1` opens the sheet directly.
- **Wrong network**: a warn-soft card "Your wallet is on a different network. NairaGuard runs on Celo." with a **Switch to Celo** pill (`wallet_switchEthereumChain`, adding the chain on 4902). The chain follows `NEXT_PUBLIC_NETWORK` (Celo / Celo Sepolia).
- **Header menu** (avatar on Overview, address chip elsewhere): wallet address + name, **Switch wallet** (reopens the sheet), **Disconnect**. The last wallet is remembered and restored silently.
- **Waitlist**: wallet optional; a secondary pill "Connect wallet" fills the wallet field. After joining with a connected non-MiniPay wallet, the "Confirm my wallet" SIWE step shows (button: "Check your wallet…" while signing).
- **Deposit**: when the wallet's cNGN and USD₮ balances are both zero — inside MiniPay, a dark pill "Top up in MiniPay" linking to `https://link.minipay.xyz/add_cash?tokens=USDT` (same tab); elsewhere, a quiet note "You'll need some USD₮ on Celo first." (bento tokens, never error styling). When the wallet has funds and is outside MiniPay, keep the fee hint "You'll need a little CELO or USDC for network fees."
- **Attribution**: every write (createVault, approve, deposit, withdraw, approve/reject swap) goes through `lib/sendTagged.ts`, which re-applies `celo_9efd0f97b491` via `toDataSuffix`, whatever the connector.

Screenshots: `nairaguard-brand/mockups/built-connect-mobile.png`, `built-connect-desktop.png`.
