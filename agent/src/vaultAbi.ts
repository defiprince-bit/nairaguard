import { parseAbi } from 'viem';

export const vaultAbi = parseAbi([
  'function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, uint256 usdValue) returns (uint256)',
  'function proposeSwap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut) returns (uint256)',
  'function swapViaRfq(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, address target, address spender, bytes data, uint256 approvalId) returns (uint256)',
  'function minOutFloor(address tokenIn, address tokenOut, uint256 amountIn) view returns (uint256)',
  'function referencePrice() view returns (uint256 price, uint8 priceDecimals)',
  'function factory() view returns (address)',
  'function approve(uint256 id) returns (uint64 expiresAt)',
  'event SwapApproved(uint256 indexed id, uint256 approvedMinOut, uint64 expiresAt)',
  'function deposit(address token, uint256 amount)',
  'function setLimits((uint256 maxTradeUsd, uint256 maxDailyUsd, uint256 approvalThresholdUsd, uint16 maxSlippageBps, uint16 targetNgnBps) newLimits)',
  'function limits() view returns (uint256 maxTradeUsd, uint256 maxDailyUsd, uint256 approvalThresholdUsd, uint16 maxSlippageBps, uint16 targetNgnBps)',
  'function dailySpentUsd() view returns (uint256)',
  'function dayStart() view returns (uint256)',
  'function paused() view returns (bool)',
  'event SwapProposed(uint256 indexed id, uint64 expiresAt)',
  'event SwapRejected(uint256 indexed id)',
  'function reject(uint256 id)',
  'event Swapped(uint256 indexed id, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut, address target)',
]);

export const erc20Abi = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
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
  'function isAllowedVenue(address target, address spender) view returns (bool)',
  'function venueLabelOf(address target) view returns (string)',
  'function setVenue(address target, address spender, bool allowed, string label)',
  'function setPriceFeed(address feed)',
  'function oracleConfig() view returns ((address feed, uint32 maxFeedAge, uint16 maxDeviationBps, bool fallbackEnabled, uint8 fallbackDecimals, uint32 fallbackMaxAge, uint64 fallbackSetAt, uint256 fallbackRate))',
  'event VenueUpdated(address indexed target, address indexed spender, bool allowed, string label)',
]);

export const mockFeedAbi = parseAbi([
  'function setAnswer(int256 answer)',
  'function owner() view returns (address)',
]);

export const vaultEventsAbi = parseAbi([
  'event Deposited(address indexed token, uint256 amount, address indexed from)',
]);
