# nairaguard
AI treasury agent on Celo that manages cNGN/USD₮ exposure, built for Agents on Open Rails.

NairaGuard swaps between cNGN and USD₮ on Textile within on-chain limits the user sets, explains every trade in plain English, and runs as a MiniPay mini app.

## Layout

| Path | What |
|---|---|
| `contracts/` | Foundry project: treasury vault |
| `agent/` | Node 22 + TypeScript + viem agent service |
| `dashboard/` | Next.js mobile-first dashboard / MiniPay mini app |
| `docs/` | Design spec (`design.md`, from the architecture lead) |
| `.cursor/rules/` | Rules for Cursor |

## Setup

1. Node 22 (`nvm use`), pnpm 9 (`corepack enable`), and Foundry (`curl -L https://foundry.paradigm.xyz | bash && foundryup`).
2. Install: `pnpm install`
3. Hook the hackathon into Cursor (from the repo root, needs your own Loops House sign-in):
   ```bash
   npx loopshouse add agents-on-open-rails
   ```
   Choose Cursor when asked.
4. Copy env templates and fill locally (never commit them):
   `cp agent/.env.example agent/.env`, `cp dashboard/.env.example dashboard/.env.local`, `cp contracts/.env.example contracts/.env`
5. Checks:
   ```bash
   cd contracts && forge test && cd ..
   pnpm typecheck && pnpm lint && pnpm build
   ```
6. Run: `pnpm --filter ./dashboard dev` and `pnpm --filter ./agent dev`.

## Deploys

`Deploy contracts` workflow (Actions → Run workflow) with `network` = `celo-sepolia` (testnet, chain 11142220, `celo-sepolia` environment) or `celo`. Uses the `DEPLOYER_PRIVATE_KEY` secret; `celo` runs in the `mainnet` environment, which requires manual approval.

## Attribution

All transactions go through the shared tx builder, which adds the attribution tag `celo_9efd0f97b491` (`agent/src/config.ts`).
