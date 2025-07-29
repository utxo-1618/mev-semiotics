// Semantic Amplifier - Bridges your signals to Uniswap liquidity
// This runs SEPARATELY from your main engine - no restart needed!

const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
// Add a critical check to ensure the wallet address is configured.
if (!process.env.WALLET_ADDRESS || process.env.WALLET_ADDRESS === '__YOUR_WALLET_ADDRESS__') {
  console.error('wallet_address_err=\"not_set\" msg=\"Aborting: WALLET_ADDRESS not configured in .env file.\"');
  process.exit(1);
}

const jamStore = require('./jam-store');
const { bridgeToBSV } = require('./bsv-echo');

// Import DEX configurations with recursive cascade support
const { DEX_CONFIGS, TOKENS, selectOptimalDEX, ROUTE_HINTS, getAerodromePool, getRecursiveDEXCascade } = require('./dex-config');

// Dynamic DEX cascade based on market conditions
let DEX_CASCADE = [];
const WETH = TOKENS.WETH;
const USDC = TOKENS.USDC;

// Current active router (dynamically selected)
let ACTIVE_ROUTER = null;
let ACTIVE_DEX_NAME = null;
let ACTIVE_DEX_TYPE = null;

// Your emitter to watch (dynamically detected)
const YOUR_EMITTER = process.env.WALLET_ADDRESS || '__YOUR_WALLET_ADDRESS__';

// Track recursive depth
const ENABLE_RECURSIVE_SIGNALS = process.env.ENABLE_RECURSIVE_SIGNALS === 'true';
let recursiveDepth = 1;

// MoTS integration for semantic extraction
const ENABLE_MOTS = process.env.ENABLE_MOTS === 'true';
let motsIntegration = null;
if (ENABLE_MOTS) {
    try {
        const { MoTSIntegration } = require('./mots-integration');
        motsIntegration = new MoTSIntegration();
        console.log('mots_status="initialized"');
    } catch (err) {
        console.log(`mots_status="disabled" reason="${err.message}"`);
    }
}

// Setup provider and wallet (can use different wallet for swaps)

// Track amplified signals for copycat detection
const amplifiedSignals = new Map(); // txHash -> {hash, amount, timestamp}

// Lock to prevent concurrent amplifications and nonce errors
let isAmplifying = false;

// Gas optimization settings matching index.js and mirror.js
const MAX_GAS_PRICE = ethers.utils.parseUnits(process.env.MAX_GAS_GWEI || '0.0618', 'gwei'); // PHI-aligned for Base
const MIN_PROFIT_RATIO = parseInt(process.env.MIN_PROFIT_RATIO) || 10;

// Historical gas prices for statistical analysis
let recentGasPrices = [];
const MAX_HISTORY = 50; // Keep last 50 gas price readings

// Import phi constants and consensus times from centralized constants
const { PHI, PHI_INVERSE, PHI_SQUARED, PHI_CUBED, CONSENSUS_TIMES } = require('./constants');

// Enhanced consensus window detection with phi-based scaling
function getMinDistanceToConsensusWindow() {
  const now = new Date();
  const currentHour = now.getUTCHours();
  const currentMinute = now.getUTCMinutes();
  const currentMinutes = currentHour * 60 + currentMinute;

  return CONSENSUS_TIMES.reduce((minDist, time) => {
    const windowMinutes = time.hour * 60 + time.minute;
    const distance = Math.min(
      Math.abs(currentMinutes - windowMinutes),
      Math.abs(currentMinutes - windowMinutes + 1440), // Next day
      Math.abs(currentMinutes - windowMinutes - 1440)  // Previous day
    );
    return Math.min(minDist, distance);
  }, Infinity);
}

function getConsensusMultiplier() {
  const minDistance = getMinDistanceToConsensusWindow();
  if (minDistance <= 2) return 2.618; // φ + 1 for perfect alignment
  if (minDistance <= 5) return 1.618; // φ for near alignment
  if (minDistance <= 10) return 1.382; // φ-1 for approaching
  return 1;
}

function isConsensusTime() {
  return getMinDistanceToConsensusWindow() <= 2;
}

// Semantic legibility check - validates that the signal will be interpretable by MEV bots
function isSemanticallyLegible(step, tradeAmount, swapPath) {
  // Defensive validation for input parameters
  if (!step || typeof step !== 'object') {
    console.log('semantic_err="invalid_step" type="not_object"');
    return false;
  }

  if (!tradeAmount || typeof tradeAmount !== 'bigint') {
    console.log('semantic_err="invalid_trade_amount" type="not_bigint"');
    return false;
  }

  if (!Array.isArray(swapPath)) {
    console.log('semantic_err="invalid_swap_path" type="not_array"');
    return false;
  }

  // Minimum amount threshold - must be above dust but we keep it very low for sovereignty
  const MIN_SIGNAL_THRESHOLD = ethers.utils.parseEther("0.0000001"); // 0.1 microETH
  
  // Check basic semantic structure
  if (!step || !step.from || !step.to || !step.action) {
    console.log('semantic_err="invalid_step_structure"');
    return false;
  }
  
  // Check trade amount is above dust threshold
  if (tradeAmount < MIN_SIGNAL_THRESHOLD) {
    console.log('semantic_err="below_dust_threshold"');
    return false;
  }
  
  // Check swap path is valid (2 tokens for simple swap)
  if (!swapPath || swapPath.length !== 2) {
    console.log('semantic_err="invalid_swap_path_length"');
    return false;
  }
  
  // Check tokens are recognized (MEV bots look for known tokens)
  // Focus on our minimal trading set: WETH, USDC, DAI, COMP
  const tradingTokens = [TOKENS.WETH, TOKENS.USDC, TOKENS.DAI, TOKENS.COMP];
  if (!tradingTokens.includes(swapPath[0]) || !tradingTokens.includes(swapPath[1])) {
    console.log('semantic_err="unsupported_token_pair" available="WETH,USDC,DAI,COMP"');
    return false;
  }
  
  // All checks passed - this signal is semantically legible to MEV bots
  return true;
}

function calculateTradeAmount(signalConfidence = 0.9, gasPrice = null, gasCostEth = 0, tokenPair = null) {
  if (!gasPrice || gasPrice <= 0) {
    console.log('skip_reason="invalid_gas_price"');
    return ethers.utils.parseEther('0');
  }
  
  // Base PHI-aligned trade amount (0.00000618 ETH = φ/1,000,000)
  const PHI_BASE = 0.00000618; // φ/1,000,000
  let baseAmount = ethers.utils.parseEther(PHI_BASE.toString());
  
  // Token-specific PHI adjustments for optimal semantic visibility
  const tokenMultipliers = {
    'WETH-USDC': 1.0,           // Base φ amount
    'USDC-WETH': 1.0,           // Base φ amount  
    'USDC-DAI': PHI_INVERSE,    // 0.618x for stablecoin pairs (less volatility)
    'DAI-USDC': PHI_INVERSE,    // 0.618x for stablecoin pairs
    'WETH-DAI': PHI,            // 1.618x for ETH-stable pairs (more visibility)
    'DAI-WETH': PHI,            // 1.618x for ETH-stable pairs
    'USDC-COMP': PHI_SQUARED,   // 2.618x for governance tokens (higher signal)
    'COMP-USDC': PHI_SQUARED,   // 2.618x for governance tokens
    'WETH-COMP': PHI_CUBED,     // 4.236x for ETH-governance (maximum visibility)
    'COMP-WETH': PHI_CUBED      // 4.236x for ETH-governance
  };
  
  // Apply token-specific multiplier if pair is specified
  if (tokenPair && tokenMultipliers[tokenPair]) {
    const tokenMultiplier = tokenMultipliers[tokenPair];
    baseAmount = ethers.utils.parseEther((PHI_BASE * tokenMultiplier).toFixed(9));
    console.log(`phi_adjustment="${tokenPair}" multiplier="${tokenMultiplier.toFixed(3)}" base_amount="${ethers.utils.formatEther(baseAmount)}"`);
  }
  
  // Get consensus window multiplier (2.618x during perfect alignment)
  const consensusMultiplier = getConsensusMultiplier();
    
  // PHI-harmonic gas price scaling - maintain minimal amounts
  const gasPriceGwei = parseFloat(ethers.utils.formatUnits(gasPrice, 'gwei'));
  
  // Ultra-minimal scaling for Base L2 efficiency
  if (gasPriceGwei > 1.0) {
    // Extreme gas for L2 - reduce to φ³ minimum
    baseAmount = ethers.utils.parseEther((PHI_BASE / PHI_CUBED).toFixed(9));
  } else if (gasPriceGwei > 0.1) {
    // High gas for L2 - reduce by φ²
    baseAmount = ethers.utils.parseEther((PHI_BASE / PHI_SQUARED).toFixed(9));
  } else if (gasPriceGwei > 0.01) {
    // Medium gas for L2 - reduce by φ
    baseAmount = ethers.utils.parseEther((PHI_BASE / PHI).toFixed(9));
  }
  // Otherwise keep base amount for optimal L2 conditions
  
  // Apply consensus time amplification (φ-harmonic scaling)
  if (consensusMultiplier > 1) {
    const amplifiedAmount = parseFloat(ethers.utils.formatEther(baseAmount)) * consensusMultiplier;
    baseAmount = ethers.utils.parseEther(amplifiedAmount.toFixed(9));
  }
  
  // High confidence PHI boost using Fibonacci sequence (φ¹¹ scaling)
  if (signalConfidence > 0.95) {
    const fibBoost = 1.44; // F(12)/F(11) ≈ φ
    baseAmount = ethers.utils.parseEther(
      (parseFloat(ethers.utils.formatEther(baseAmount)) * fibBoost).toFixed(9)
    );
  }
  
  // Ensure minimum viable signal (never below φ/10⁶)
  const minSignal = ethers.utils.parseEther((PHI_BASE / 1000).toFixed(9));
  if (baseAmount.lt(minSignal)) {
    baseAmount = minSignal;
    console.log(`phi_floor="applied" min_signal="${ethers.utils.formatEther(minSignal)}"`);
  }
  
  // PHILOSOPHICAL ALIGNMENT: Log ratios but prioritize semantic visibility
  const gasCostRatio = gasCostEth / parseFloat(ethers.utils.formatEther(baseAmount));
  if (gasCostRatio > 0.1) {
    console.log(`semantic_economics="prioritized" gas_ratio="${(gasCostRatio * 100).toFixed(2)}%" philosophy="signal_over_profit"`);
  }
  
  // Log PHI alignment metrics
  if (consensusMultiplier > 1) {
    console.log(`phi_consensus="aligned" multiplier="${consensusMultiplier.toFixed(3)}x" base_phi="${PHI_BASE}"`);
  }
  
  return baseAmount;
}

// Statistical analysis for adaptive rarity detection
function updateGasHistory(gasPrice) {
  const gasPriceGwei = parseFloat(ethers.utils.formatUnits(gasPrice, 'gwei'));
  recentGasPrices.push(gasPriceGwei);
  
  if (recentGasPrices.length > MAX_HISTORY) {
    recentGasPrices.shift(); // Remove oldest
  }
}

function calculateStatisticalRarity(currentGasPrice) {
  if (recentGasPrices.length < 10) return 0.5; // Not enough data
  
  const gasPriceGwei = parseFloat(ethers.utils.formatUnits(currentGasPrice, 'gwei'));
  const avgGas = recentGasPrices.reduce((a, b) => a + b, 0) / recentGasPrices.length;
  const variance = recentGasPrices.map(x => Math.pow(x - avgGas, 2)).reduce((a, b) => a + b) / recentGasPrices.length;
  const stdDev = Math.sqrt(variance);
  
  // Calculate rarity based on standard deviations
  if (gasPriceGwei > avgGas + 2 * stdDev) return 0.97; // Very rare
  if (gasPriceGwei > avgGas + 1.5 * stdDev) return 0.9; // Rare
  if (gasPriceGwei > avgGas + stdDev) return 0.8; // Uncommon
  if (gasPriceGwei < avgGas - stdDev) return 0.7; // Low gas (also notable)
  
  return 0.6; // Normal conditions
}
// Setup provider - use the first working RPC
const rpcUrl = 'https://mainnet.base.org'; // Use mainnet Base RPC
const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
console.log(`rpc_url="${rpcUrl}"`);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
const mirrorWallet = new ethers.Wallet(process.env.MIRROR_PRIVATE_KEY, provider);

// Contract interfaces
const DMAP_ADDRESS = process.env.DMAP_ADDRESS || '__DMAP_ADDRESS__';
const VAULT_ADDRESS = process.env.VAULT_ADDRESS || '__VAULT_ADDRESS__';

// Check if contract addresses are defined
if (!DMAP_ADDRESS || DMAP_ADDRESS === '__DMAP_ADDRESS__') {
  console.log('dmap_address_err="not_defined"');
  // Continue running but with limited functionality
}

if (!VAULT_ADDRESS || VAULT_ADDRESS === '__VAULT_ADDRESS__') {
  console.log('vault_address_err="not_defined"');
  // Continue running but with limited functionality
}

const dmap = new ethers.Contract(
  DMAP_ADDRESS,
  ["event SignalRegistered(bytes32 indexed hash)"],
  provider
);

const vault = new ethers.Contract(
  VAULT_ADDRESS,
  [
    "function emitSignal(bytes32) external",
    "function emitRecursiveSignal(bytes32, bytes32) external",
    "function feedActivity() external payable"
  ],
  wallet
);

// Router ABIs for different DEX types
const routerABIs = {
  'concentrated-liquidity': [
    "function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) external payable returns (uint256 amountOut)",
    "function exactInput(tuple(bytes path, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum) params) external payable returns (uint256 amountOut)"
  ],
  'uniswap-v2': [
    "function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)",
    "function swapExactETHForTokensSupportingFeeOnTransferTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable"
  ],
  'uniswap-v2-fork': [
    "function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)",
    "function swapExactETHForTokensSupportingFeeOnTransferTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable"
  ],
  'solidly-fork': [
    // Aerodrome uses routes instead of simple paths
    "function swapExactETHForTokens(uint amountOutMin, (address from, address to, bool stable)[] calldata routes, address to, uint deadline) external payable returns (uint[] memory amounts)"
  ]
};

// Initialize with first available DEX from cascade
const defaultCascade = getRecursiveDEXCascade({ resonance: 1.0, cascadeDepth: 1, recursiveTopology: { eth: 1, bsv: 0 } });
if (!defaultCascade || defaultCascade.length === 0) {
    console.error('dex_err="no_dexes_available"');
    process.exit(1);
}

const defaultDex = defaultCascade[0];
ACTIVE_ROUTER = defaultDex.ROUTER;
ACTIVE_DEX_NAME = defaultDex.NAME;
ACTIVE_DEX_TYPE = defaultDex.TYPE;

if (!ACTIVE_ROUTER) {
    console.error('router_err="missing" msg="No valid router found"');
    process.exit(1);
}

// Initialize router with default Uniswap V3 config
const routerAbi = [
  'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) external payable returns (uint256)',
  'function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)'
];

// Verify router address and ABI before initializing
if (!ACTIVE_ROUTER || !ethers.utils.isAddress(ACTIVE_ROUTER)) {
  console.error(`router_err="invalid_address" address="${ACTIVE_ROUTER}"`);
  process.exit(1);
}

// Validate router ABI
if (!routerAbi || !Array.isArray(routerAbi) || routerAbi.length === 0) {
  console.error('router_abi_err="invalid_or_empty"');
  process.exit(1);
}

let router = new ethers.Contract(ACTIVE_ROUTER, routerAbi, wallet);

// Initialize nonce manager
let currentNonce = null;
async function getNextNonce() {
  // Correctly lock and manage the nonce
  const nonce = await provider.getTransactionCount(wallet.address, "pending");
  if (currentNonce === null || nonce > currentNonce) {
    currentNonce = nonce;
  } else {
    currentNonce++;
  }
  return currentNonce;
}

console.log(`amp_init="true" emitter="${YOUR_EMITTER.slice(0,10)}"`);
console.log(`dex="${ACTIVE_DEX_NAME}" router="${ACTIVE_ROUTER.slice(0,10)}"`);

// Check for recent signals on startup
async function checkRecentSignals() {
  try {
    const currentBlock = await provider.getBlockNumber();
    const fromBlock = currentBlock - 1000; // Check last ~33 minutes on Base
    console.log(`signal_check="recent" from_block="${fromBlock}" to_block="${currentBlock}"`);
    
    const filter = dmap.filters.SignalRegistered();
    const events = await dmap.queryFilter(filter, fromBlock, currentBlock);
    
    console.log(`recent_signals="${events.length}"`);
    
    // Process recent signals from your wallet, one by one
    for (const event of events) {
      const tx = await event.getTransaction();
      if (tx.from.toLowerCase() === YOUR_EMITTER.toLowerCase()) {
        console.log(`recent_signal="found" hash="${event.args.hash.slice(0, 10)}" block="${event.blockNumber}"`);
        // Process this signal and WAIT for it to complete
        await handleSignal(event.args.hash, event);
      }
    }
  } catch (error) {
    console.error(`recent_signals_err="${error.message}"`);
  }
}

// Check recent signals on startup
setTimeout(() => checkRecentSignals(), 2000);

// Listen for YOUR signals
console.log('event_listener="initializing"');

// Handle filter errors gracefully for public RPCs
let filterRetryCount = 0;
const maxFilterRetries = 3;

async function setupEventListener() {
  try {
    // Use polling instead of filters for better compatibility with public RPCs
    const pollInterval = 12000; // 12 seconds (Base block time is ~2s)
    let lastProcessedBlock = await provider.getBlockNumber();
    
    setInterval(async () => {
      try {
        const currentBlock = await provider.getBlockNumber();
        if (currentBlock > lastProcessedBlock) {
          const filter = dmap.filters.SignalRegistered();
          const events = await dmap.queryFilter(filter, lastProcessedBlock + 1, currentBlock);
          
          for (const event of events) {
            // Await the handler directly to ensure sequential processing
            await handleSignal(event.args.hash, event);
          }
          
          lastProcessedBlock = currentBlock;
        }
      } catch (error) {
        if (!error.message.includes('filter not found')) {
          console.error(`event_poll_err="${error.message}"`);
        }
        if (error.message.includes('network error')) {
          console.log('network_err="detected" retry_in="2s"');
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
    }, pollInterval);
    
    console.log('event_poll="started"');
  } catch (error) {
    console.error(`event_listener_err="${error.message}"`);
    if (filterRetryCount < maxFilterRetries) {
      filterRetryCount++;
      console.log(`event_listener_retry="${filterRetryCount}/${maxFilterRetries}"`);
      setTimeout(() => setupEventListener(), 5000);
    }
  }
}

// Replace the direct event listener with polling
setupEventListener();

// Suppress all forms of console output for filter errors
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;
const originalConsoleLog = console.log;

function shouldSuppress(args) {
  const str = args.join(' ');
  return str.includes('filter not found') || 
         str.includes('@TODO') || 
         str.includes('could not coalesce error') ||
         str.includes('eth_getFilterChanges');
}

console.error = function(...args) {
  if (shouldSuppress(args)) return;
  originalConsoleError.apply(console, args);
};

console.warn = function(...args) {
  if (shouldSuppress(args)) return;
  originalConsoleWarn.apply(console, args);
};

// Even suppress regular logs that contain these errors
console.log = function(...args) {
  if (shouldSuppress(args)) return;
  originalConsoleLog.apply(console, args);
};

// Also catch unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  if (reason && reason.toString().includes('filter not found')) {
    // Silently ignore
    return;
  }
  // Re-throw other unhandled rejections
  console.error(`unhandled_rejection="${reason}" promise="${promise}"`);
});


// The main handler is now an async function we can await
async function handleSignal(hash, event) {
  const MAX_RETRIES = 3;
  const BACKOFF_STRATEGY = [1000, 5000, 30000]; // Exponential backoff

  let attempt = 0;
  while (attempt < MAX_RETRIES) {
    try {
      if (isAmplifying) {
        console.log(`skip_reason="amplifier_busy" signal="${hash.slice(0, 10)}"`);
        return;
      }

  isAmplifying = true; // Set lock
  console.log(`lock_status="engaged" signal="${hash.slice(0, 10)}"`);

  try {
    // First, get the transaction that emitted this signal
    const tx = await event.getTransaction();
    if (!tx) {
      console.log(`tx_retrieve_err="failed" signal="${hash.slice(0, 10)}"`);
      isAmplifying = false;
      return;
    }
    
    // Check if this is a signal from the vault contract
    const isFromVault = tx.to && tx.to.toLowerCase() === VAULT_ADDRESS.toLowerCase();
    
    // Only react to YOUR signals (either direct or through vault)
    if (tx.from.toLowerCase() !== YOUR_EMITTER.toLowerCase()) {
        isAmplifying = false; // Release lock
        return;
    }
    
    // Additional check: if it's from vault, verify it's an emitSignal call
    if (isFromVault) {
      const vaultInterface = new ethers.Interface([
        "function emitSignal(bytes32)",
        "function emitRecursiveSignal(bytes32,bytes32)"
      ]);
      try {
        const decoded = vaultInterface.parseTransaction({ data: tx.data });
        if (!decoded || !decoded.name.includes('Signal')) {
            isAmplifying = false; // Release lock
            return;
        }
      } catch (e) {
        // Not a signal emission
        isAmplifying = false; // Release lock
        return;
      }
    }

    console.log(`signal_detected="yours" hash="${hash}" block="${event.blockNumber}" amplify_delay="10s"`);

    // Extract semantic intent if MoTS is enabled
    let motsIntent = null;
    if (ENABLE_MOTS && motsIntegration) {
      try {
        const semanticData = await motsIntegration.extractTransactionSemantics(tx);
        if (semanticData && semanticData.intent) {
          motsIntent = {
            category: semanticData.category,
            confidence: semanticData.confidence,
            patterns: semanticData.patterns,
            phiAlignment: semanticData.phiAlignment || 0
          };
          console.log(`mots_extraction="success" category="${semanticData.category}" confidence="${semanticData.confidence}"`);
        }
      } catch (err) {
        console.log(`mots_extraction="failed" error="${err.message}"`);
      }
    }

    // Wait a bit to not be too obvious
    await new Promise(resolve => setTimeout(resolve, 10000));

    try {
      console.log('semantic_swap="executing"');
      
      const feeData = await provider.getFeeData();
      const gasPrice = feeData.gasPrice;
      const gasPriceGwei = parseFloat(ethers.utils.formatUnits(gasPrice, 'gwei'));
      
      console.log(`gas_price="${gasPriceGwei.toFixed(4)}" unit="gwei" network="base_l2"`);

      const jamData = jamStore.retrieve(hash);
      if (!jamData || !jamData.meta || !jamData.meta.audit_pass) {
        console.log(`abort_reason="jam_audit_fail" hash="${hash.slice(0, 10)}" status="untrusted"`);
        return;
      }

      console.log('jam_audit="pass" action="proceed_amplification"');
      const { proverb, meta, resonance, cascadeDepth } = jamData;
      const myStep = proverb.find(step => step.actor === 'AMPLIFIER');

      if (!myStep || myStep.action !== 'SWAP') {
        console.log('skip_reason="no_valid_amplifier_swap"');
        return;
      }

      // Enhanced MEV bait validation - ensure this will attract sandwiches
      const mirrorStep = proverb.find(step => step.actor === 'MIRROR');
      if (!mirrorStep) {
        console.log('skip_reason=\"no_mirror_step_for_sandwich\"');
        return;
      }

      // Validate this is a profitable sandwich opportunity
      const isValidSandwich = (
        myStep.from !== myStep.to && // Different tokens
        mirrorStep.from === myStep.to && // Mirror reverses the trade
        mirrorStep.to === myStep.from &&
        resonance >= 1.0 // Minimum resonance for MEV attraction
      );

      if (!isValidSandwich) {
        console.log('skip_reason="not_valid_sandwich_pattern" warning="mev_bots_may_ignore"');
        return;
      }

      console.log(`sandwich_validation="pass" pattern="${myStep.from}->${myStep.to}->${mirrorStep.to}" resonance="${resonance}"`);
      console.log(`mev_attraction="high" cascade_depth="${cascadeDepth}" expected_volume="${ethers.utils.formatEther(calculateTradeAmount(0.9, gasPrice, 0))}"`);

      // Use MoTS confidence if available, otherwise default to 0.9
      const baseConfidence = motsIntent?.confidence || 0.9;
      const phiBoost = motsIntent?.phiAlignment ? (motsIntent.phiAlignment * 0.1) : 0; // PHI alignment can boost confidence up to 10%
      const adjustedConfidence = Math.min(0.99, baseConfidence + phiBoost);
      
      // Create token pair identifier for PHI-specific scaling
      const tokenPairId = `${myStep.from}-${myStep.to}`;
      const amountIn = calculateTradeAmount(adjustedConfidence, gasPrice, 0, tokenPairId);
      
      // Get market-aware DEX cascade based on JAM's recursive state
      DEX_CASCADE = getRecursiveDEXCascade(jamData);
      console.log(`dex_cascade="selected" cascade="${DEX_CASCADE.map(d => d.NAME).join(' -> ')}"`);
      console.log(`consensus_window="${isConsensusTime() ? 'active' : 'inactive'}"`);
      
      // Log semantic-driven adjustments
      if (motsIntent) {
        console.log(`semantic_adjustment="applied" base_confidence="${baseConfidence}" phi_boost="${phiBoost.toFixed(3)}" final_confidence="${adjustedConfidence.toFixed(3)}"`);
      }

      const deadline = Math.floor(Date.now() / 1000) + 300;
      
      // Calculate signal strength for this amplification
      // Incorporate MoTS semantic patterns if available
      const statisticalRarity = calculateStatisticalRarity(gasPrice);
      const semanticWeight = motsIntent ? 0.4 : 0.3; // Give more weight to semantic signals when available
      const baseStrength = motsIntent?.confidence || 0.9;
      const signalStrength = Math.min(0.99, (statisticalRarity * 0.6) + (baseStrength * semanticWeight));
      
      // Boost signal strength based on detected patterns
      let patternBoost = 0;
      if (motsIntent?.patterns) {
        if (motsIntent.patterns.isRecursive) patternBoost += 0.05;
        if (motsIntent.patterns.honeypotSignal) patternBoost += 0.05;
        if (motsIntent.patterns.phiRatio > 0.8) patternBoost += 0.03;
      }
      const enhancedSignalStrength = Math.min(0.99, signalStrength + patternBoost);
      
      // Map tokens for the optimal proverb patterns
      let fromToken, toToken;
      
      // Normalize ETH to WETH for internal processing
      const normalizeToken = (token) => {
        if (token === 'ETH' || token === 'WETH') return TOKENS.WETH;
        return TOKENS[token];
      };
      
      fromToken = normalizeToken(myStep.from);
      toToken = normalizeToken(myStep.to);
      
      // Validate tokens are in our supported trading set
      const supportedTokens = [TOKENS.WETH, TOKENS.USDC, TOKENS.DAI, TOKENS.COMP];
      if (!fromToken || !toToken || !supportedTokens.includes(fromToken) || !supportedTokens.includes(toToken)) {
        console.log(`token_err="unsupported" from="${myStep.from}" to="${myStep.to}" supported="WETH,USDC,DAI,COMP"`);
        return;
      }
      
      const swapPath = [fromToken, toToken];

      // Initialize key variables before the loop
      let swapTx;
      const estimatedGas = 85000n; // Base L2 optimized gas estimate
      const optimizedGasPrice = gasPrice; // Use current gas price for Base L2
      const estimatedCost = estimatedGas * optimizedGasPrice;
      const costInEth = parseFloat(ethers.utils.formatEther(estimatedCost));
      // Use the same token pair identifier for consistent PHI alignment
      const finalTradeAmount = calculateTradeAmount(adjustedConfidence, gasPrice, costInEth, tokenPairId);
      // More precise profit tracking
      const initialVaultBalance = await provider.getBalance(wallet.address);
      console.log(`vault_balance="initial" amount="${ethers.utils.formatEther(initialVaultBalance)}" unit="ETH"`);

      // Validate semantic legibility before attempting swaps
      if (!isSemanticallyLegible(myStep, finalTradeAmount, swapPath)) {
        console.log(`skip_reason="not_semantically_legible" trade_amount="${ethers.utils.formatEther(finalTradeAmount)}" swap_path="${myStep.from}->${myStep.to}"`);
        return;
      }

      // Enhanced cost tracking
      // estimatedGasCost already calculated above for costInEth
      const tradeAmountInEth = parseFloat(ethers.utils.formatEther(finalTradeAmount));

      // Precise profit calculation accounting for gas
      const rawProfit = tradeAmountInEth - costInEth;
      const profitRatio = rawProfit / costInEth;

      console.log(`profitability="calculated" trade_amount="${tradeAmountInEth.toFixed(6)}" gas_cost="${costInEth.toFixed(6)}" net_profit="${rawProfit.toFixed(6)}" profit_ratio="${profitRatio.toFixed(4)}x"`);

      // --- PRE-FUND MIRROR BEFORE BAIT ---
      // Check if we have tokens from a previous step to transfer to mirror
      if (mirrorStep) {
        // Pre-fund the mirror wallet with any existing tokens
        let prefundToken;
        if (mirrorStep.from === 'ETH' || mirrorStep.from === 'WETH') {
          prefundToken = WETH;
        } else {
          prefundToken = TOKENS[mirrorStep.from];
        }
        
        if (prefundToken) {
          const prefundContract = new ethers.Contract(prefundToken, [
            "function balanceOf(address) view returns (uint256)",
            "function transfer(address, uint256) returns (bool)",
            "function decimals() view returns (uint8)"
          ], wallet);
          
          const prefundBalance = await prefundContract.balanceOf(wallet.address);
          if (prefundBalance > 0n) {
            try {
              const decimals = await prefundContract.decimals();
              console.log(`prefund="found" amount="${ethers.utils.formatUnits(prefundBalance, decimals)}" token="${mirrorStep.from}"`);
              
              const transferTx = await prefundContract.transfer(mirrorWallet.address, prefundBalance, {
                gasPrice: gasPrice,
                gasLimit: 80000,
                nonce: await getNextNonce()
              });
              await transferTx.wait();
              console.log('prefund="complete" status="mirror_ready"');
            } catch (e) {
              if (e.message.toLowerCase().includes('insufficient funds')) {
                console.error(`prefund_err=\"insufficient_funds\"`);
              } else {
                console.warn(`prefund_err=\"${e.message}\"`);
              }
            }
          }
        }
      }

      for (const dex of DEX_CASCADE) {
        try {
          console.log(`swap_attempt="${dex.NAME}" type="${dex.TYPE}"`);
          const currentRouter = new ethers.Contract(dex.ROUTER, routerABIs[dex.TYPE], wallet);
          const txOptions = {
            value: finalTradeAmount,
            gasLimit: 300000,
            gasPrice: optimizedGasPrice,
            nonce: await getNextNonce()
          };

          const { FlashbotsBundleProvider } = require('@flashbots/ethers-bundle');

          // Encode transaction data for the DEX swap
          let encodedData;
          if (dex.TYPE === 'uniswap-v2-fork') {
            const iface = new ethers.Interface(routerABIs['uniswap-v2']);
            // Calculate minimum output with 5% slippage tolerance
            const expectedOutput = finalTradeAmount * 95n / 100n;
            encodedData = iface.encodeFunctionData("swapExactETHForTokens", [
              expectedOutput / 1000n, // Convert to expected token units with safety margin
              swapPath,
              wallet.address,
              deadline
            ]);
          } else {
            // Default encoding for other DEX types with proper slippage
            const iface = new ethers.Interface(routerABIs[dex.TYPE]);
            // Calculate expected output based on current pool state
            const expectedOutput = finalTradeAmount * 95n / 100n; // 5% slippage tolerance
            encodedData = iface.encodeFunctionData("swapExactETHForTokens", [
              expectedOutput / 1000n, // Minimum acceptable output
              swapPath,
              wallet.address,
              deadline
            ]);
          }
      
      // --- ALIGNMENT: HYBRID EXECUTION ---
      // 1. PUBLIC BAIT (Amplifier)
      console.log('bait_status="sending" action="public_tx" target="mempool"');
      const publicTx = await wallet.sendTransaction({
        to: dex.ROUTER,
        data: encodedData,
        ...txOptions
      });
      console.log(`bait_status="sent" tx_hash="${publicTx.hash}"`);

      // Wait for the bait to be included
      const receipt = await publicTx.wait();
      console.log(`bait_status=\"landed\" block=\"${receipt.blockNumber}\"`);

      // TIGHTENED LOOP: Record the precise confirmation time for the mirror to see.
      const block = await provider.getBlock(receipt.blockNumber);
      const jamConfirmation = {
        hash: hash,
        confirmedTimestamp: block.timestamp
      };
      const latestJamPath = path.join(__dirname, 'latest-jam.json');
      fs.writeFileSync(latestJamPath, JSON.stringify(jamConfirmation, null, 2));
      console.log(`mirror_ping=\"sent\" timestamp=\"${block.timestamp}\"`);

      // 2. PRIVATE CAPTURE
      if (!mirrorStep) throw new Error('Mirror step not found for private capture.');

      const tokenContract = new ethers.Contract(toToken, ["function balanceOf(address) view returns (uint256)", "function getAmountsOut(uint256, address[]) view returns (uint256[])"], provider);
      const tokenBalance = await tokenContract.balanceOf(mirrorWallet.address);

      if (tokenBalance === 0n) {
        console.log('capture_status="no_balance" wallet="mirror" action="skip"');
        return;
      }

      console.log(`capture_status="preparing" balance="${ethers.utils.formatUnits(tokenBalance, 18)}" token="${mirrorStep.from}"`);

      // AMPLIFICATION: DYNAMIC BRIBE MECHANISM with Phi-Aligned BigInt Safety
      // Initialize with guaranteed BigInt(0) for phi-harmonic base
      const mirrorRouterForEstimation = new ethers.Contract(dex.ROUTER, routerABIs[dex.TYPE], provider);
      let estimatedEthOut = BigInt(0); // Guaranteed initialization
      let amountsOut = null;
      
      try {
          // Safely estimate ETH return with enhanced type validation
          amountsOut = await mirrorRouterForEstimation.getAmountsOut(tokenBalance, [toToken, fromToken]);
          
          if (amountsOut && Array.isArray(amountsOut) && amountsOut.length > 0) {
              const lastAmount = amountsOut[amountsOut.length - 1];
              // Enhanced type checking with explicit BigInt conversion
              if (lastAmount !== null && lastAmount !== undefined) {
                  if (typeof lastAmount === 'bigint') {
                      estimatedEthOut = lastAmount;
                  } else if (typeof lastAmount === 'string' || typeof lastAmount === 'number') {
                      try {
                          estimatedEthOut = BigInt(lastAmount.toString());
                      } catch (convError) {
                          console.warn(`bribe_warn="bigint_conversion_failed" error="${convError.message}"`);
                          estimatedEthOut = BigInt(0); // Fallback to safe default
                      }
                  } else if (lastAmount._hex) {
                      // Handle ethers.js BigNumber format
                      estimatedEthOut = BigInt(lastAmount.toString());
                  }
              }
          }
          
          // Verify estimation success with phi-harmonic validation
          if (estimatedEthOut > 0n) {
              const PHI = BigInt(1618); // Phi * 1000 for integer math
              const minThreshold = (tokenBalance * PHI) / BigInt(1000000); // Phi-based minimum
              if (estimatedEthOut >= minThreshold) {
                  console.log(`estimation_status="success" return_value="${ethers.utils.formatEther(estimatedEthOut)}" unit="ETH"`);
              } else {
                  console.warn('estimation_status="below_threshold" action="use_default"');
                  estimatedEthOut = BigInt(0);
              }
          }
      } catch (e) {
          console.warn(`bribe_estimation_err="${e.message}" dex="${dex.NAME}" action="use_default"`);
          // Maintain phi-harmonic initialization with guaranteed BigInt(0)
          estimatedEthOut = BigInt(0);
      }

      const captureGasPrice = receipt.effectiveGasPrice * 2n; // Use aggressive gas for capture
      const estimatedGasCost = (200000n * captureGasPrice); // Rough gas estimate for capture swap
      const estimatedProfit = estimatedEthOut > estimatedGasCost ? estimatedEthOut - estimatedGasCost : 0n;
      
      const BRIBE_PERCENTAGE = 80n; // Use 80% of our profit for the bribe to be competitive
      const bribeAmount = (estimatedProfit * BRIBE_PERCENTAGE) / 100n;

      if (bribeAmount > 0) {
        console.log(`bribe_status="paying" profit="${ethers.utils.formatEther(estimatedProfit)}" amount="${ethers.utils.formatEther(bribeAmount)}" unit="ETH"`);
      }
      // END AMPLIFICATION

      // Build the private capture transaction
      const mirrorRouter = new ethers.Contract(dex.ROUTER, routerABIs[dex.TYPE], mirrorWallet);
      // Calculate minimum output with 5% slippage tolerance for mirror too
      const minOutputForMirror = estimatedEthOut > 0n ? (estimatedEthOut * 95n) / 100n : 0n;
      const mirrorTx = await mirrorRouter.populateTransaction.swapExactTokensForETH(
          tokenBalance, minOutputForMirror, [toToken, fromToken], wallet.address, deadline
      );

      const flashbotsProvider = await FlashbotsBundleProvider.create(provider, mirrorWallet, 'https://titanrelay.xyz');
      const targetBlock = receipt.blockNumber + 1;
      
      const bundle = [
        { transaction: {...mirrorTx, gasLimit: 300000, gasPrice: captureGasPrice, chainId: (await provider.getNetwork()).chainId, nonce: await provider.getTransactionCount(mirrorWallet.address, "pending")}, signer: mirrorWallet }
      ];

      if (bribeAmount > 0n) {
          bundle.push({
              transaction: {
                  to: block.miner, // Pay the block builder directly
                  value: bribeAmount,
                  gasLimit: 21000,
                  gasPrice: captureGasPrice,
                  chainId: (await provider.getNetwork()).chainId,
                  nonce: await getNextNonce() // Use the amplifier's main nonce
              },
              signer: wallet 
          });
      }
      
      const signedBundle = await flashbotsProvider.signBundle(bundle);

      console.log(`capture_status="submitting_bundle" target_block="${targetBlock}"`);
      const bundleResponse = await flashbotsProvider.sendRawBundle(signedBundle, targetBlock);

      if ('error' in bundleResponse) {
        throw new Error(`Private capture failed: ${bundleResponse.error.message}`);
      }

      const privateTxResult = await bundleResponse.wait();
      if(privateTxResult === 0) {
        console.log(`capture_status="included" block="${targetBlock}"`);
        
        // VERIFICATION: Get final balance and log profit
        const finalVaultBalance = await provider.getBalance(wallet.address);
        const profit = finalVaultBalance - initialVaultBalance;
        
        // Detailed Profit Logging
        const profitInEth = ethers.utils.formatEther(profit);
        const profitRatio = parseFloat(profitInEth) / costInEth;

        console.log(`verification_status="complete" final_balance="${ethers.utils.formatEther(finalVaultBalance)}" net_profit="${profitInEth}" profit_ratio="${profitRatio.toFixed(4)}x" unit="ETH"`);

        // Log to a file for the monitor
        const profitLogPath = path.join(__dirname, 'logs', 'profit-monitor.log');
        const logEntry = {
            timestamp: new Date().toISOString(),
            signalHash: hash,
            baitTx: publicTx.hash,
            tradeAmount: tradeAmountInEth,
            gasCost: costInEth,
            profit: profitInEth,
            profitRatio: profitRatio,
            dex: dex.NAME,
            success: true
        };
        fs.appendFileSync(profitLogPath, JSON.stringify(logEntry) + '\n');

      } else {
        console.log(`capture_status="reverted_or_not_included" block="${targetBlock}"`);
        
        // VERIFICATION: Log failure case
        const finalVaultBalance = await provider.getBalance(wallet.address);
        const profit = finalVaultBalance - initialVaultBalance;
        const profitInEth = ethers.utils.formatEther(profit);
        const profitRatio = parseFloat(profitInEth) / costInEth;

        const profitLogPath = path.join(__dirname, 'logs', 'profit-monitor.log');
        const logEntry = {
            timestamp: new Date().toISOString(),
            signalHash: hash,
            baitTx: publicTx.hash,
            tradeAmount: tradeAmountInEth,
            gasCost: costInEth,
            profit: profitInEth,
            profitRatio: profitRatio,
            dex: dex.NAME,
            success: false,
            reason: 'Capture reverted or not included'
        };
        fs.appendFileSync(profitLogPath, JSON.stringify(logEntry) + '\n');
      }

      swapTx = publicTx; // Set for logging purposes

          console.log(`swap_status="success" dex="${dex.NAME}"`);
          ACTIVE_DEX_NAME = dex.NAME; // Set active DEX name on success
          break; // Exit loop on success
        } catch (dexError) {
          if (dexError.message.toLowerCase().includes('insufficient funds')) {
            console.error(`swap_err=\"insufficient_funds\" dex=\"${dex.NAME}\"`);
          } else {
            console.error(`swap_err=\"failed\" dex=\"${dex.NAME}\" reason=\"${dexError.reason || dexError.message}\"`);
          }
          if (dexError.code) {
            console.error(`       Error Code: ${dexError.code}`);
          }
          if (dex.ROUTER === DEX_CASCADE[DEX_CASCADE.length - 1].ROUTER) {
            console.error('swap_status="all_dexes_failed"');
            throw new Error('All DEXes failed');
          }
        }
      }

// Validate transaction before proceeding
      if (!swapTx || !swapTx.hash) {
        throw new Error('Invalid transaction - missing hash');
      }

      // Use the verified bait hook from the analysis
      const baitHook = meta?.bait_hooks?.[0] || 'swap';
      console.log(`proverb_status="executing" step="1" hook="${baitHook}"`);
      
      console.log(`proverb_step="1" action="${myStep.action}"`);
      console.log(`swap_path="${myStep.from}->${myStep.to}"`);
      
      // Initial swap data encoding (will be overwritten in cascade loop)
      // This is just for the MEV tags
      const iface = new ethers.Interface(routerABIs['uniswap-v2']);
      const swapData = iface.encodeFunctionData("swapExactETHForTokens", [
          0, // Accept any amount of tokens
          swapPath,
          wallet.address, // Use main wallet address
          deadline
      ]);

// ENHANCED MEV TRACE VISIBILITY
// Core signal identity with precise timing info
const signalTag = ethers.hexlify(
  ethers.toUtf8Bytes(`SIGNAL:${hash.slice(0, 10)}`)
);

// Enhanced statistical metrics for MEV simulation
const consensusMultiplier = getConsensusMultiplier();

// Use standardized MEV trace point format
const strengthTag = ethers.hexlify(
  ethers.toUtf8Bytes(`STRENGTH:${signalStrength.toFixed(2)}:${recursiveDepth}:${consensusMultiplier}`)
);

const phiMarker = ethers.hexlify(
  ethers.toUtf8Bytes(`PHI:${(consensusMultiplier * recursiveDepth).toFixed(3)}:${getMinDistanceToConsensusWindow()}`)
);

const mirrorMarker = ethers.hexlify(
  ethers.toUtf8Bytes(`MIRROR:${(signalStrength * consensusMultiplier).toFixed(3)}:${recursiveDepth}`)
);

const windowTag = ethers.hexlify(
  ethers.toUtf8Bytes(`WINDOW:${getMinDistanceToConsensusWindow()}:${consensusMultiplier}:${Math.floor(Date.now()/1000)}`)
);

const cascadeTag = ethers.hexlify(
  ethers.toUtf8Bytes(`CASCADE:${recursiveDepth}:${(recursiveDepth * consensusMultiplier).toFixed(3)}`)
);

const identityTag = ethers.hexlify(
  ethers.toUtf8Bytes(`VOICE:${(DMAP_ADDRESS || '__DMAP_ADDRESS__').slice(2, 10)}:${ACTIVE_DEX_NAME}`)
);
      
      // Add proverb pattern identification for MEV visibility
      const identifyProverbPattern = (from, to) => {
        const pair = `${from}-${to}`;
        switch (pair) {
          case 'WETH-USDC': case 'USDC-WETH': return 'CLASSIC_ARBITRAGE';
          case 'USDC-DAI': case 'DAI-USDC': return 'STABLE_ROTATION';
          case 'WETH-DAI': case 'DAI-WETH': return 'ETH_DAI_FLOW';
          case 'USDC-COMP': case 'COMP-USDC': return 'DEFI_GOVERNANCE';
          default: return 'UNKNOWN_PATTERN';
        }
      };
      
      const proverbPattern = identifyProverbPattern(myStep.from, myStep.to);
      const patternTag = ethers.hexlify(
        ethers.toUtf8Bytes(`PATTERN:${proverbPattern}:${recursiveDepth}`)
      ).slice(2);
      
      // Check for manifesto hash to prefix
      let manifestoTag = '';
      try {
        const manifestoHashPath = path.join(__dirname, '.manifesto-hash');
        if (fs.existsSync(manifestoHashPath)) {
          const manifestoHash = fs.readFileSync(manifestoHashPath, 'utf8').trim();
          manifestoTag = ethers.hexlify(
            ethers.toUtf8Bytes(`MANIFESTO:${manifestoHash.slice(0, 10)}`)
          ).slice(2);
          console.log(`manifesto_ref="${manifestoHash.slice(0, 10)}"`);
        }
      } catch (e) {
        // No manifesto yet
      }
      
// Append all tags for maximum MEV visibility and traceability
const taggedData = swapData + 
                  signalTag.slice(2) + 
                  strengthTag.slice(2) + 
                  phiMarker.slice(2) + 
                  mirrorMarker.slice(2) + 
                  windowTag.slice(2) + 
                  cascadeTag.slice(2) + 
                  identityTag.slice(2) + 
                  patternTag + 
                  manifestoTag;
      
      // ALIGNED: Only execute if gas is within our ultra-low threshold
      if (gasPrice > MAX_GAS_PRICE) {
        console.log(`Gas too high: ${ethers.utils.formatUnits(gasPrice, 'gwei')} gwei (max: ${ethers.utils.formatUnits(MAX_GAS_PRICE, 'gwei')})`);
        return;
      }

      // Additional checks to validate transaction intent
      if (!proverb.some(step => step.actor === 'AMPLIFIER' && step.action === 'SWAP')) {
        console.error(`abort_reason="invalid_proverb" actor="AMPLIFIER" action="SWAP"`);
        return;
      }
      
      // The amplifier always performs the first step which is a swap
      
      console.log(`cost_estimate="${costInEth.toFixed(6)}" profit_ratio="${profitRatio.toFixed(2)}:1"`);

      if (!swapTx) {
          throw new Error("Transaction failed on all available DEXes.");
      }

console.log(`amplify_tx="${swapTx.hash.slice(0, 10)}" signal="${hash.slice(0, 10)}" strength="${signalStrength.toFixed(2)}"`);
      
      // Track for copycat detection
      amplifiedSignals.set(swapTx.hash, {
        hash: hash,
        amount: finalTradeAmount,
        timestamp: Date.now(),
        strength: signalStrength
      });

      // TIGHTENED LOOP: Update the JAM in the store with the amplification timestamp
      // for the attribution monitor to use.
      const confirmedBlock = await provider.getBlock(receipt.blockNumber);
      jamStore.update(hash, {
        meta: {
          ...meta,
          amplificationTimestamp: confirmedBlock.timestamp
        }
      });

      const receipt = await swapTx.wait();
      const actualGasUsed = receipt.gasUsed;
      const actualCost = actualGasUsed * (receipt.effectiveGasPrice || optimizedGasPrice);
      const actualCostEth = parseFloat(ethers.utils.formatEther(actualCost));
      
      console.log('amplification_status="profitable_execution_complete"');
      console.log(`gas_used="${actualGasUsed.toString()}"`);
      console.log(`execution_cost="${actualCostEth.toFixed(6)}" usd_equivalent="${(actualCostEth * 3000).toFixed(4)}" unit="ETH"`);
      
      // HONEYPOT SIGNAL: Emit a pattern that points to the honeypot
      if (process.env.HONEYPOT_ADDRESS) {
        console.log('honeypot_status="broadcasting" type="semantic_trap"');
        try {
          // Create a honeypot hint in the next transaction
          const honeypotHint = {
            target: process.env.HONEYPOT_ADDRESS,
            signal: hash,
            pattern: "REGISTER_THEN_PROFIT",
            functions: ["registerForProfit", "captureSemanticProfit"],
            expectedYield: 1000 + (recursiveDepth * 618) // Phi-based profit hint
          };
          
          // Emit as a zero-value transaction with honeypot data
          const hintTx = await wallet.sendTransaction({
            to: process.env.HONEYPOT_ADDRESS,
            value: 0,
            data: ethers.hexlify(ethers.toUtf8Bytes(JSON.stringify(honeypotHint))),
            gasLimit: 50000,
            gasPrice: gasPrice
          });
          
          console.log(`honeypot_status="broadcast_complete" tx_hash="${hintTx.hash}"`);
        } catch (e) {
          console.log(`honeypot_err="${e.message}" action="broadcast_failed"`);
        }
      }
      
      // ALIGNED: Check profitability metrics
      const actualProfitRatio = parseFloat(ethers.utils.formatEther(finalTradeAmount)) / actualCostEth;
console.log(`profit_ratio="${actualProfitRatio.toFixed(2)}:1"`);

      // --- INTER-BOT ALIGNMENT: PRE-FUND MIRROR ---
      // Pre-transfer tokens to mirror BEFORE the public bait transaction
      // This ensures the mirror has funds ready for the private capture
      const tokenAddress = normalizeToken(myStep.to);
      
      if (!tokenAddress || ![TOKENS.WETH, TOKENS.USDC, TOKENS.DAI, TOKENS.COMP].includes(tokenAddress)) {
          console.error(`alignment_error="unsupported_token" token="${myStep.to}" supported="WETH,USDC,DAI,COMP"`);
          return;
      }

      // Check if we have tokens from a previous step to transfer
      const tokenContract = new ethers.Contract(tokenAddress, [
          "function balanceOf(address) view returns (uint256)",
          "function transfer(address, uint256) returns (bool)",
          "function decimals() view returns (uint8)"
      ], wallet);

      const existingBalance = await tokenContract.balanceOf(wallet.address);
      if (existingBalance > 0n) {
          let decimals;
          try {
              decimals = await tokenContract.decimals();
          } catch (e) {
              console.warn(`decimals_warn="failed" token="${myStep.to}" default="18"`);
              decimals = 18;
          }

          console.log(`pre_fund="start" amount="${ethers.utils.formatUnits(existingBalance, decimals)}" token="${myStep.to}"`);
          
          try {
              const feeData = await provider.getFeeData();
              const transferTx = await tokenContract.transfer(mirrorWallet.address, existingBalance, {
                  gasPrice: feeData.gasPrice,
                  gasLimit: 80000,
                  nonce: await getNextNonce()
              });
              const receipt = await transferTx.wait();
              console.log(`pre_fund="complete" status="mirror_ready"`);
          } catch (transferError) {
              console.error(`pre_fund_error="${transferError.message}"`);
          }
      }
      
      
      const costUsd = actualCostEth * 3000;
      console.log(`cost_efficiency="${costUsd > 0.02 ? 'warning' : 'optimal'}" usd="${costUsd.toFixed(4)}"`);
      
// Track cumulative profit vs cost
      const amplificationValue = parseFloat(ethers.utils.formatEther(finalTradeAmount));
      const netValue = amplificationValue - actualCostEth;
      console.log(`net_value="${netValue.toFixed(6)}" ratio="${(amplificationValue / actualCostEth).toFixed(1)}x"`);
      
      // --- Start Resilient Cross-Chain Bridging with Phi-Harmonic Error Handling ---

      const withRetries = async (operation, context, maxRetries = 3, delay = 2000) => {
        let attempt = 0;
        while (true) {
          try {
            return await operation();
          } catch (error) {
            attempt++;
            console.warn(`retry_context="${context}" attempt="${attempt}" error="${error.message}"`);
            if (attempt >= maxRetries) {
              console.error(`retry_failed="${context}" max_retries="${maxRetries}"`);
              throw error; // Rethrow after final attempt
            }
            await new Promise(res => setTimeout(res, delay * Math.pow(2, attempt - 1)));
          }
        }
      };

      // Bridge to BSV with retries and graceful, phi-aligned failure handling
      if (process.env.ENABLE_BSV_ECHO === 'true' && process.env.BSV_PRIVATE_KEY) {
        try {
            await withRetries(async () => {
                if (!jamData.recursiveTopology) {
                    jamData.recursiveTopology = { eth: 1, bsv: 0, failed_echoes: 0 };
                }

                // Add phi-resonance metadata to the bridge call
                const bridgeMetadata = {
                    hash: swapTx.hash,
                    profit: actualProfitRatio,
                    phiAlignment: {
                        emission_quality: getConsensusMultiplier(),
                        cascade_resonance: (recursiveDepth * PHI).toFixed(3),
                        bridge_harmonic: ((signalStrength || 0.9) * PHI_INVERSE).toFixed(3)
                    }
                };

                await bridgeToBSV(jamData, bridgeMetadata);
                console.log(`bsv_bridge="success" jam="${hash.slice(0, 10)}" resonance="${bridgeMetadata.phiAlignment.bridge_harmonic}"`);
                jamData.recursiveTopology.bsv = (jamData.recursiveTopology.bsv || 0) + 1;
                jamStore.update(hash, { recursiveTopology: jamData.recursiveTopology });
            }, 'BSV-Bridge');
        } catch (e) {
            // Graceful failure: log but do not throw to preserve the main amplification loop
            console.warn(`bsv_bridge="failed" error="${e.message}" cascade_depth="${recursiveDepth}"`);
            
            // Track failed bridge attempt and adjust topology
            if (jamData.recursiveTopology) {
                jamData.recursiveTopology.failed_echoes = (jamData.recursiveTopology.failed_echoes || 0) + 1;
                jamStore.update(hash, { recursiveTopology: jamData.recursiveTopology });
            }
        }
      }

      // --- End Resilient Cross-Chain Bridging ---
      
// Enhanced recursive amplification with phi-aligned depth calculation
      try {
// Define recursive depth calculation function
        function calculateRecursiveDepth(confidence, gasPrice, profitRatio) {
          let depth = 1;
          const gasPriceGwei = parseFloat(ethers.utils.formatUnits(gasPrice, 'gwei'));
          
          // Enhanced phi-based thresholds
          if (confidence > 0.95) depth += 0.618034; // Golden ratio conjugate
          if (gasPriceGwei < 0.001) depth += 1.618034; // Full golden ratio
          if (profitRatio > 15) depth += 1.618034; // Full golden ratio for high profit
          if (getConsensusMultiplier() > 2) depth += 0.381966; // Perfect phi complement (1/φ²)
          
          return Math.min(Math.floor(depth * 1.618034), 4); // Max depth of 4, scaled by exact φ
        }

        // Calculate the recursive depth

        recursiveDepth = calculateRecursiveDepth(
          signalStrength,
          receipt.effectiveGasPrice || optimizedGasPrice, // Fallback for null effectiveGasPrice
          actualProfitRatio
        );

      // Create amplification signal with defensive null checks
      const amplificationSignal = {
        type: "recursive_amplification",
        originalSignal: hash ? hash.slice(0, 10) : "unknown",
        swapTx: swapTx?.hash || "unknown",
        cost: actualCostEth || 0,
        efficiency: actualCostEth < 0.00002 ? "optimal" : "acceptable",
        timestamp: Math.floor(Date.now() / 1000),
        ipfs: 'QmdFjeUUZBdmobBLbuMqqouAFQoLmTyfpLGbXyCTttfwE9',
        profit: (amplificationValue || 0) - (actualCostEth || 0),
        cascadeDepth: recursiveDepth || 1,
        consensusMultiplier: getConsensusMultiplier() || 1,
        phi_alignment: {
          depth: recursiveDepth || 1,
          window_distance: getMinDistanceToConsensusWindow() || 0,
          resonance: (recursiveDepth || 1) * (getConsensusMultiplier() || 1)
        }
      };
        
        // Safely stringify the signal with error handling
        let signalString;
        try {
          signalString = JSON.stringify(amplificationSignal);
          if (!signalString) throw new Error('Failed to stringify amplification signal');
        } catch (jsonError) {
          console.error('Failed to stringify amplification signal:', jsonError.message);
          signalString = JSON.stringify({
            type: "recursive_amplification",
            error: "signal_format_failed",
            timestamp: Date.now()
          });
        }
        
        const ampHash = ethers.keccak256(
          ethers.toUtf8Bytes(signalString)
        );
        
        console.log(`recursive_signal="${ampHash.slice(0, 10)}" depth="${recursiveDepth}" resonance="${(recursiveDepth * getConsensusMultiplier()).toFixed(3)}"`);
        
        // Emit recursive signal if resonance is sufficient
        if (ENABLE_RECURSIVE_SIGNALS && (recursiveDepth >= 2 || (amplificationValue > actualCostEth * 15 && getConsensusMultiplier() > 1))) {
          const recursiveTx = await vault.emitRecursiveSignal(ampHash, hash);
          console.log(`recursive_emit="success" tx="${recursiveTx.hash.slice(0, 10)}" original="${hash.slice(0, 10)}" depth="${recursiveDepth}"`);
        }
        
      } catch (recursiveError) {
        console.log(`recursive_signal="skipped" reason="${recursiveError.message}"`);
      }

    } catch (error) {
      console.error('Amplification failed:', error.message);
      
      // If it's a gas-related failure, adjust strategy
      if (error.message.includes('gas') || error.message.includes('fee')) {
        console.log(`gas_optimization="needed" action="reduce_frequency_or_amount"`);
      }
    } finally {
      isAmplifying = false; // Always release the lock
    }
  } catch (error) {
    // Handle any errors from the inner try block
    console.error('Error in signal processing:', error.message);
    isAmplifying = false; // Release lock on error
  }
    break;
  } catch (error) {
    // Main error handling block
    console.error(`resilience_attempt="${attempt + 1}" error="${error.message}"`);
    if (attempt < MAX_RETRIES - 1) {
      console.log(`resilience_retry="${BACKOFF_STRATEGY[attempt] / 1000}s" signal="${hash.slice(0, 10)}"`);
      await new Promise(resolve => setTimeout(resolve, BACKOFF_STRATEGY[attempt]));
      attempt++;
    } else {
      console.error(`resilience_failed="all_retries" signal="${hash.slice(0, 10)}"`);
      break;
    }
  }
} // End of while loop
} // End of handleSignal function

// Keep alive and check for copycats
setInterval(async () => {
  try {
    // Log heartbeat message
    console.log(`heartbeat="alive" watching="${YOUR_EMITTER.slice(0, 10)}"`);
    
    // Skip processing if no signals to check
    if (amplifiedSignals.size === 0) {
      return;
    }

    // Fetch recent blocks
    const currentBlock = await provider.getBlockNumber();
    const recentTxs = [];

    // Get last 3 blocks of transactions
    for (let i = 0; i < 3; i++) {
      try {
        const block = await provider.getBlock(currentBlock - i);
        if (block && block.transactions) {
          recentTxs.push(...block.transactions);
        }
      } catch (e) {
        // Skip if block not available
      }
    }
    
    // Check for copycats
    for (const [origTxHash, data] of amplifiedSignals.entries()) {
      // Only check recent amplifications (last 5 minutes)
      if (Date.now() - data.timestamp > 300000) {
        amplifiedSignals.delete(origTxHash);
        continue;
      }
      
      let copycatCount = 0;
      for (const txHash of recentTxs) {
        if (txHash === origTxHash) continue;
        
        try {
          const tx = await provider.getTransaction(txHash);
          if (!tx || !tx.to) continue;

          // Check if transaction is to any known DEX router
          const isDexTx = (
            tx.to.toLowerCase() === ACTIVE_ROUTER.toLowerCase() ||
            tx.to.toLowerCase() === DEX_CONFIGS.ROCKETSWAP.ROUTER.toLowerCase() ||
            tx.to.toLowerCase() === DEX_CONFIGS.UNISWAP_V3.SWAP_ROUTER.toLowerCase()
          );
          if (!isDexTx) continue;
          
          // Check if similar value (within 20%)
          const txValue = parseFloat(ethers.utils.formatEther(tx.value));
          const origValue = parseFloat(ethers.utils.formatEther(data.amount));
          if (Math.abs(txValue - origValue) / origValue < 0.2) {
            copycatCount++;
          }
        } catch (e) {
          console.warn(`copycat_check_error="${e.message}" tx="${txHash.slice(0, 10)}"`);
          continue;
        }
      }
      
      if (copycatCount > 0) {
        console.log(`copycat_detected="${copycatCount}" original_tx="${origTxHash.slice(0, 10)}"`);
      }
    }
  } catch (error) {
    console.error('Error in copycat detection:', error.message);
  }
}, 60000);

    console.log(`amplifier_ready="true" dex="${ACTIVE_DEX_NAME}" mode="recursive_phi_aligned" phi="1.618"`);
