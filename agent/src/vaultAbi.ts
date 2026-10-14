import { parseAbi } from 'viem';

export const vaultAbi = parseAbi([
  'function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, uint256 usdValue) returns (uint256)',
  'function proposeSwap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, uint256 usdValue) returns (uint256)',
  'function deposit(address token, uint256 amount)',
  'function setLimits((uint256 maxTradeUsd, uint256 maxDailyUsd, uint256 approvalThresholdUsd, uint16 maxSlippageBps, uint16 targetNgnBps) newLimits)',
  'function limits() view returns (uint256 maxTradeUsd, uint256 maxDailyUsd, uint256 approvalThresholdUsd, uint16 maxSlippageBps, uint16 targetNgnBps)',
  'function dailySpentUsd() view returns (uint256)',
  'function dayStart() view returns (uint256)',
  'function paused() view returns (bool)',
  'event SwapProposed(uint256 indexed id, uint64 expiresAt)',
  'event Swapped(uint256 indexed id, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut)',
]);

export const erc20Abi = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function mint(address to, uint256 amount)',
]);

export const mockRouterAbi = parseAbi([
  'function setRate(address token, uint256 rate)',
  'function ratePerToken(address) view returns (uint256)',
]);

export const factoryAbi = parseAbi([
  'function createVault((uint256 maxTradeUsd, uint256 maxDailyUsd, uint256 approvalThresholdUsd, uint16 maxSlippageBps, uint16 targetNgnBps) limits) returns (address)',
  'function vaultOf(address owner) view returns (address)',
  'function vaultCount() view returns (uint256)',
  'function allVaults(uint256) view returns (address)',
  'event VaultCreated(address indexed owner, address indexed vault)',
]);

export const vaultEventsAbi = parseAbi([
  'event Deposited(address indexed token, uint256 amount, address indexed from)',
]);
