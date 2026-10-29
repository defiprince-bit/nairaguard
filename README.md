# nairaguard
AI treasury agent on Celo that manages cNGN/USD₮ exposure, built for Agents on Open Rails.

NairaGuard swaps between cNGN and USD₮ on Textile within on-chain limits the user sets, explains every trade in plain English, and runs as a MiniPay mini app.

**Live demo:** https://nairaguard.space/app (landing + waitlist: https://nairaguard.space). Private, closed demo on Celo mainnet.

## On-chain (Celo mainnet, chain 42220)

| Contract | Address |
|---|---|
| VaultFactory | [`0xfe37fbea39ce656d7f8181e946e723b7b0d8cecb`](https://celoscan.io/address/0xfe37fbea39ce656d7f8181e946e723b7b0d8cecb) (start block `80805463`) |
| VaultImplementation | [`0xf639c92039905c7cdbac585031fee1d953ac9efe`](https://celoscan.io/address/0xf639c92039905c7cdbac585031fee1d953ac9efe) |
| Agent wallet | [`0xA2A173A481BC063fEE0EF11c67Fc756DC5f928f4`](https://celoscan.io/address/0xA2A173A481BC063fEE0EF11c67Fc756DC5f928f4) |
| cNGN | [`0xF6829D7393dAe24509eb1E52eE8e572e2E271a4f`](https://celoscan.io/address/0xF6829D7393dAe24509eb1E52eE8e572e2E271a4f) |
| USD₮ | [`0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e`](https://celoscan.io/address/0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e) |
| Chainlink NGN/USD | [`0xc17cBE2dB40e53F4984C46F608DA6DA1fF074c11`](https://celoscan.io/address/0xc17cBE2dB40e53F4984C46F608DA6DA1fF074c11) |
| Textile LimitOrderReactor | [`0xa9AA0a64769cBed4d3B1Ceb4Df01CdE915C235b3`](https://celoscan.io/address/0xa9AA0a64769cBed4d3B1Ceb4Df01CdE915C235b3) |
| Textile VaultOrderExecutor | [`0x01b006d5c687bde182aa36F542f1f014144742e2`](https://celoscan.io/address/0x01b006d5c687bde182aa36F542f1f014144742e2) |

Sample transactions:

| What | Tx |
|---|---|
| Agent rebalance fill via Textile (tagged `celo_9efd0f97b491` at the end of Input Data, view as UTF-8) | [`0x2c62d94b…fff2`](https://celoscan.io/tx/0x2c62d94b2fb6906ef8fd9477589304400b3a18f5bbbd090052dfb8ef0482fff2) |
| VaultFactory deploy | [`0x8e8bbbe0…5c9c`](https://celoscan.io/tx/0x8e8bbbe02bc49a45716da4789ed6b618ad4203d0aa729b3158a6f04748e35c9c) |
| VaultImplementation deploy | [`0x3cdacc04…eac7`](https://celoscan.io/tx/0x3cdacc04d7383fac78803df5653dc29388ee659478a257352fbffd4b9f2beac7) |
| setVenue LimitOrderReactor | [`0x1717c8f3…9edd`](https://celoscan.io/tx/0x1717c8f3d80b28ed22941d14a3548574f9c8b8910695812793353c7b09e19edd) |
| setVenue VaultOrderExecutor | [`0xc1b619e5…e3b8`](https://celoscan.io/tx/0xc1b619e5b342a6380c8c525d21fec158237aab025873be3e795f32dbb58ee3b8) |

ERC-8004 identity: [agent 9987](https://erc-8004.quicknode.com/agents/celo-mainnet/9987). Full deployment notes: [`docs/mainnet-deployment.md`](docs/mainnet-deployment.md).

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
5. Checks (agent tests run offline: no network, keys or env needed; they use in-memory PGlite):
   ```bash
   pnpm test
   cd contracts && forge test && cd ..
   pnpm typecheck && pnpm lint && pnpm build
   ```
6. Run: `pnpm --filter ./dashboard dev` and `pnpm --filter ./agent dev`.

## Deploys

`Deploy contracts` workflow (Actions → Run workflow) with `network` = `celo-sepolia` (testnet, chain 11142220, `celo-sepolia` environment) or `celo`. Uses the `DEPLOYER_PRIVATE_KEY` secret; `celo` runs in the `mainnet` environment, which requires manual approval.

## Attribution

All transactions go through the shared tx builder, which adds the attribution tag `celo_9efd0f97b491` (`agent/src/config.ts`).
