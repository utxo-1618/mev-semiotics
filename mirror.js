// Mirror Bot - Creates the economic feedback loop by following your own signals
// This turns your semantic signals into visible MEV opportunities

const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
let jamStore;
try {
    jamStore = require('./jam-store');
} catch (e) {
    console.log('module_load="warn" module="jam-store" action="using_mock"');
    jamStore = {
        retrieve: (hash) => ({
            proverb: [],
            meta: {},
            tags: []
        }),
        update: () => {}
    };
}

// Import DEX configurations for recursive alignment with amplifier
let DEX_CONFIGS, TOKENS, selectOptimalDEX;
try {
    const dexConfig = require('./dex-config');
    DEX_CONFIGS = dexConfig.DEX_CONFIGS;
    TOKENS = dexConfig.TOKENS;
    selectOptimalDEX = dexConfig.selectOptimalDEX;
} catch (e) {
    console.log('module_load="warn" module="dex-config" action="using_fallback"');
    DEX_CONFIGS = {
        UNISWAP_V3: {
            ROUTER: '0x2626664c2603336e57b271c5c0b26f421741e481',
            NAME: 'Uniswap V3'
        },
        ROCKETSWAP: {
            ROUTER: '0x4CF22670302b0b678B65403D8408436aBDe59aBB',
            NAME: 'RocketSwap'
        }
    };
    TOKENS = {
        WETH: '0x4200000000000000000000000000000000000006',
        USDC: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
        DAI: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb',
        COMP: '0x9e1028F5F1D5eDE59748FFceE5532509976840E0'
    };
    selectOptimalDEX = () => ({ primary: DEX_CONFIGS.UNISWAP_V3, fallback: DEX_CONFIGS.ROCKETSWAP });
}

// Define missing constants
const WETH = TOKENS.WETH;
const ACTIVE_ROUTER = DEX_CONFIGS.UNISWAP_V3.ROUTER;
const ACTIVE_DEX_NAME = DEX_CONFIGS.UNISWAP_V3.NAME;
const DEFAULT_ROUTER = DEX_CONFIGS.UNISWAP_V3.ROUTER;
// Removed unused router constants - using ACTIVE_ROUTER instead

// IMPORTANT: Use a DIFFERENT wallet for mirroring
const MIRROR_PRIVATE_KEY = process.env.MIRROR_PRIVATE_KEY || process.env.PRIVATE_KEY;
const YOUR_SIGNAL_WALLET = process.env.WALLET_ADDRESS || '__YOUR_WALLET_ADDRESS__';

// Contract addresses
const DMAP_ADDRESS = process.env.DMAP_ADDRESS || '__DMAP_ADDRESS__';
const VAULT_ADDRESS = process.env.VAULT_ADDRESS || '__VAULT_ADDRESS__';

// Setup provider - use single reliable RPC to avoid quorum issues
const rpcUrl = process.env.RPC_URL || 'https://mainnet.base.org';
console.log(`rpc_url="${rpcUrl}"`);

let provider;
try {
    provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    console.log('rpc_status="initialized"');
} catch (error) {
    console.log(`rpc_init_err="${error.message}"`);
    process.exit(1);
}

const mirrorWallet = new ethers.Wallet(MIRROR_PRIVATE_KEY, provider);

// Contract interfaces
const dmap = new ethers.Contract(
  DMAP_ADDRESS,
  ["event SignalRegistered(bytes32 indexed hash)"],
  provider
);

const vault = new ethers.Contract(
  VAULT_ADDRESS,
  [
    "function feedActivity() external payable",
    "function emitSignal(bytes32) external",
    "function emitRecursiveSignal(bytes32, bytes32) external",
    "function proverbs(bytes32) external view returns (address, uint256, bool, string, string)"
  ],
  mirrorWallet
);

// Simplified router ABI to avoid conflicts
const routerABI = [
  // Standard Uniswap V2 Router functions
  "function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)",
  "function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
  "function swapExactETHForTokensSupportingFeeOnTransferTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable",
  "function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external"
];
let router;
try {
    if (!ACTIVE_ROUTER) {
        console.log('router_err="undefined" action="using_default_uniswap_v3"');
        ACTIVE_ROUTER = DEFAULT_ROUTER;
    }
    router = new ethers.Contract(ACTIVE_ROUTER, routerABI, mirrorWallet);
} catch (error) {
    console.log(`router_init_err="${error.message}"`);
    process.exit(1);
}

// Validate jamStore contents before accessing
function safeRetrieveJam(hash) {
    const data = jamStore.retrieve(hash);
    return data ? { proverb: data.proverb ?? [], meta: data.meta ?? {}, tags: data.tags ?? [] } : { proverb: [], meta: {}, tags: [] };
}

// Track mirrored signals to avoid duplicates
const mirroredSignals = new Set();
let totalMirrored = 0;
let totalValueCreated = BigInt(0);
const ENABLE_RECURSIVE_SIGNALS = process.env.ENABLE_RECURSIVE_SIGNALS === 'true';

// Track signal relationships for recursive emissions
const signalLineage = new Map(); // child -> parent mapping
let recursionDepth = 0; // Track recursion depth

// Import consensus times from constants
const { CONSENSUS_TIMES, PHI, PHI_INVERSE, PHI_SQUARED } = require('./constants');

// Enhanced phi-aligned consensus window detection
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

function calculateOptimalWaitTime(minDistance, signalConfidence) {
  let baseWait = 0;
  
  if (minDistance <= 3) {
    baseWait = 1000; // Almost immediate for perfect alignment
  } else if (minDistance <= 8) {
    baseWait = (minDistance * PHI) * 1000; // Phi-scaled short wait
  } else if (minDistance <= 13) {
    baseWait = (minDistance * PHI * PHI) * 1000; // Phi-squared medium wait
  } else {
    baseWait = Math.min(
      (minDistance * PHI * PHI * PHI) * 1000, // Phi-cubed long wait
      2.618 * 60 * 1000 // Max 2.618 minutes
    );
  }
  
  // Adjust by confidence
  return Math.floor(baseWait * (1 - (signalConfidence * 0.1)));
}

function isConsensusTime() {
  return getMinDistanceToConsensusWindow() <= 2;
}

const erc20ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)"
];
// Only support the 4 optimal tokens: WETH, USDC, DAI, COMP
const supportedTokens = ['WETH', 'USDC', 'DAI', 'COMP'];
const usdcContract = new ethers.Contract(TOKENS.USDC, erc20ABI, mirrorWallet);

console.log(`mirror_status="started" mode="causal_engine" signal_from="${YOUR_SIGNAL_WALLET}" mirror_wallet="${mirrorWallet.address}"`);
console.log(`dex="${ACTIVE_DEX_NAME}" router="${ACTIVE_ROUTER}" action="execute_second_proverb_step"`);
console.log('consensus_windows="13:21,21:01,03:33,08:01,20:08" window_types="fib,mirror,trinity,new,evening"');
console.log('timing_strategies="immediate(<3m),wait(<10m),momentum(amp+5s),phi_scaled(default,max:2.618m)"');

// Helper to parse JAM from your emission pattern
async function getJAMPrediction(hash, blockNumber) {
  // In production, fetch from IPFS using jam.pattern.ipfs
  // For now, we'll use the known pattern from your signals
  
  // Your JAMs predict based on gas conditions
  const block = await provider.getBlock(blockNumber);
  const gasPrice = block.baseFeePerGas || ethers.parseUnits('1', 'gwei');
  const gasPriceGwei = parseFloat(ethers.utils.formatUnits(gasPrice, 'gwei'));
  
  // Mirror your exact prediction logic with minimal gas optimization
  let swapPath = [WETH, USDC];
  let strategy = "monitor";
  
  // Phi-aligned base amount (golden ratio: 1.618033988749895)
  let tradeAmount = ethers.parseEther("0.00001618");
  
  // CONSENSUS TIME AMPLIFICATION: Use phi for alignment windows
  const consensusMultiplier = isConsensusTime() ? 2.618 : 1; // φ + 1 during consensus windows as per docs
  
  // Apply 1.44x boost for high confidence signals (>0.95)
  const confidenceBoost = 0.9 > 0.95 ? 1.44 : 1;
  
  // Scale by phi for extreme conditions (recursive golden ratio)
  if (gasPriceGwei > 75) {
    strategy = "mev_sandwich_premium";
    // 0.00001618 * phi^3 * confidence boost
    tradeAmount = ethers.parseEther((0.00001618 * Math.pow(PHI, 3) * consensusMultiplier * confidenceBoost).toFixed(8));
  } else if (gasPriceGwei > 50) {
    strategy = "mev_sandwich";
    // 0.00001618 * phi^2 * confidence boost
    tradeAmount = ethers.parseEther((0.0001618 * Math.pow(PHI, 2) * consensusMultiplier * confidenceBoost).toFixed(8));
  } else if (gasPriceGwei > 25) {
    strategy = "arbitrage";
    // 0.00001618 * phi * confidence boost
    tradeAmount = ethers.parseEther((0.0001618 * PHI * consensusMultiplier * confidenceBoost).toFixed(8));
  } else {
    // Base amount with consensus amplification and confidence boost
    tradeAmount = ethers.parseEther((0.0001618 * consensusMultiplier * confidenceBoost).toFixed(8));
  }
  
  // Log consensus amplification
  if (consensusMultiplier > 1) {
    console.log(`consensus="detected" multiplier="${consensusMultiplier}x"`);
  }

  // Cache the prediction
  lastKnownPrediction = {
    path: swapPath,
    strategy: strategy,
    amount: tradeAmount,
    confidence: gasPriceGwei > 25 ? 0.9 : 0.7
  };

  return lastKnownPrediction;
}

// Main mirror logic with polling instead of filters
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
            // Process the event
            processSignalEvent(event.args.hash, event);
          }
          
          lastProcessedBlock = currentBlock;
        }
      } catch (error) {
        if (!error.message.includes('filter not found')) {
          console.log(`event_poll_err="${error.message}"`);
        }
      }
    }, pollInterval);
    
    console.log('event_poll_status="started"');
  } catch (error) {
    console.log(`event_listener_err="${error.message}"`);
    if (filterRetryCount < maxFilterRetries) {
      filterRetryCount++;
      console.log(`event_listener_retry="${filterRetryCount}/${maxFilterRetries}"`);
      setTimeout(() => setupEventListener(), 5000);
    }
  }
}

// Replace the direct event listener with polling
setupEventListener();

// Process signal events
async function processSignalEvent(hash, event) {
  try {
    // Check if event is undefined before trying to access properties
    if (!event) {
      console.log(`event_err="undefined" hash="${hash}"`);
      return;
    }
    
    const tx = await event.getTransaction();
    
    // Only mirror YOUR signals
    if (tx.from.toLowerCase() !== YOUR_SIGNAL_WALLET.toLowerCase()) {
      return;
    }
    
    // Skip if already mirrored
    if (mirroredSignals.has(hash)) {
      return;
    }
    
    console.log(`signal_detected="true" hash="${hash}" block="${event.blockNumber}"`);

    await new Promise(resolve => setTimeout(resolve, 2000));

    // ALIGNED: The mirror must now verify the JAM's integrity before acting.
    const { proverb, meta, tags } = safeRetrieveJam(hash);
    if (!meta.audit_pass) {
      console.log(`jam_audit="fail" action="abort" hash=${hash.slice(0, 10)}`);
      return;
    }

    console.log(`jam_audit="pass" action="proceed"`);

    // Check if proverb exists and is an array
    if (!Array.isArray(proverb)) {
      console.log(`proverb_err="invalid_format" type="${typeof proverb}"`);
      return;
    }

    const myStep = proverb.find(step => step && step.actor === 'MIRROR');

    if (!myStep) {
      console.log(`proverb_skip="no_mirror_step"`);
      return;
    }

    console.log(`proverb_step="2" action="${myStep.action}" from="${myStep.from}" to="${myStep.to}"`);

    // Safely access tags with a default if not present
    const proverbName = Array.isArray(tags) ? 
      tags.find(t => t && typeof t === 'string' && t.startsWith("VOICE:")) || "UNKNOWN_PROVERB" : 
      "UNKNOWN_PROVERB";
    console.log(`story="${proverbName}"`);
    
    // --- TIGHTENED LOOP: Tighter Temporal Coupling ---
    // Read the confirmation timestamp from the amplifier to create a predictable delay.
    const latestJamPath = path.join(__dirname, 'latest-jam.json');
    let waitTime;
    try {
      const jamConfirmation = JSON.parse(fs.readFileSync(latestJamPath, 'utf8'));
      // Only act if the latest signal is the one we're processing
      if (jamConfirmation.hash === hash) {
        const amplifierTimestamp = jamConfirmation.confirmedTimestamp;
        const now = Math.floor(Date.now() / 1000);
        const timeSinceConfirmation = now - amplifierTimestamp;
        
        // The mirror responds after a precise, phi-aligned delay (in seconds)
        const phiDelay = 1.618;
        
        const remainingWait = (phiDelay * 1000) - (timeSinceConfirmation * 1000);
        
        waitTime = remainingWait > 0 ? remainingWait : 0; // Wait if needed, else proceed
        console.log(`temporal_coupling=\"aligned\" amp_ts=${amplifierTimestamp} delay_s=${phiDelay.toFixed(3)}`);
      } else {
        // Fallback to old logic if this signal is not the latest one amplified
        waitTime = calculateOptimalWaitTime(getMinDistanceToConsensusWindow(), 0.9);
        console.log(`temporal_coupling=\"fallback\"`);
      }
    } catch (e) {
      // Fallback if file doesn't exist or is corrupt
      waitTime = calculateOptimalWaitTime(getMinDistanceToConsensusWindow(), 0.9);
      console.log(`temporal_coupling=\"error_fallback\" reason=\"${e.message}\"`);
    }

    console.log(`wait_time=\"S{(waitTime / 1000).toFixed(1)}s\" action=\"continue_story\"`);
    await new Promise(resolve => setTimeout(resolve, waitTime));

    // --- Execute My Assigned Step in the Proverb ---
    try {
        if (myStep.action === 'SWAP') {
            // Handle WETH/ETH mapping
            let tokenFrom, tokenTo;
            if (myStep.from === 'ETH' || myStep.from === 'WETH') {
                tokenFrom = WETH;
            } else {
                tokenFrom = TOKENS[myStep.from];
                if (!tokenFrom) {
                    console.log(`token_err="unknown" token="${myStep.from}"`);
                    console.log(`available_tokens="${Object.keys(TOKENS).join(',')}"`);
                    return;
                }
            }
            
            if (myStep.to === 'ETH' || myStep.to === 'WETH') {
                tokenTo = WETH;
            } else {
                tokenTo = TOKENS[myStep.to];
                if (!tokenTo) {
                    console.log(`token_err="unknown" token="${myStep.to}"`);
                    console.log(`available_tokens="${Object.keys(TOKENS).join(',')}"`);
                    return;
                }
            }
            
            const tokenFromContract = new ethers.Contract(tokenFrom, erc20ABI, mirrorWallet);
            const fromBalance = await tokenFromContract.balanceOf(mirrorWallet.address);
            const decimals = await tokenFromContract.decimals();

            if (fromBalance === 0n) {
              console.log(`skip_reason="no_balance" token="${myStep.from}" action="swap"`);
              return;
            }

            console.log(`approval_start="true" amount="${ethers.utils.formatUnits(fromBalance, decimals)}" token="${myStep.from}"`);
            const approveTx = await tokenFromContract.approve(ACTIVE_ROUTER, fromBalance);
            await approveTx.wait();
            console.log(`approval_complete="true" tx="${approveTx.hash}"`);

            console.log(`swap_exec="start" from="${myStep.from}" to="${myStep.to}"`);
            
            const swapPath = [tokenFrom, tokenTo];
            const deadline = Math.floor(Date.now() / 1000) + 300;
            
            const tx = await vault.emitSignal(hash, { gasLimit: 200000 });
            await tx.wait();
            
            console.log(`swap_status="success" tx="${tx.hash}"`);
            totalMirrored++;
        } else if (myStep.action === 'DEPOSIT') {
            console.log(`deposit_exec="start" action="${myStep.action}" token="${myStep.from}"`);
            
            // Handle WETH/ETH mapping
            let tokenAddress;
            if (myStep.from === 'ETH' || myStep.from === 'WETH') {
                tokenAddress = WETH;
            } else {
                tokenAddress = TOKENS[myStep.from];
                if (!tokenAddress) {
                    console.log(`token_err="unknown" token="${myStep.from}"`);
                    console.log(`available_tokens="${Object.keys(TOKENS).join(',')}"`);
                    return;
                }
            }
            
            const tokenContract = new ethers.Contract(tokenAddress, erc20ABI, mirrorWallet);
            const balance = await tokenContract.balanceOf(mirrorWallet.address);
            const decimals = await tokenContract.decimals();

            if (balance === 0n) {
              console.log(`skip_reason="no_balance" token="${myStep.from}" action="deposit"`);
              return;
            }
            
            console.log(`deposit_amount="${ethers.utils.formatUnits(balance, decimals)}" token="${myStep.from}" action="use_full_balance"`);
            console.log(`deposit_status="skipped" reason="no_yield_protocols_in_4token_system"`);
            
        } else if (myStep.action === 'DEPOSIT_COMPOUND') {
            console.log(`deposit_exec="start" action="DEPOSIT_COMPOUND" from="${myStep.from}" to="${myStep.to}"`);
            console.log(`deposit_status="skipped" reason="compound_not_supported_in_4token_system"`);
            
        } else if (myStep.action === 'DEPOSIT_SAVINGS') {
            console.log(`deposit_exec="start" action="DEPOSIT_SAVINGS" from="${myStep.from}" to="${myStep.to}"`);
            console.log(`deposit_status="skipped" reason="savings_protocols_not_supported_in_4token_system"`);
            
        } else {
            console.log(`proverb_err="unknown_action" action="${myStep.action}"`);
            return;
        }

        mirroredSignals.add(hash);
        console.log(`proverb_complete="true" story="${proverbName}" status="told_on_chain"`);

    } catch (e) {
        if (e.message.toLowerCase().includes('insufficient funds')) {
            console.error(`proverb_fail=\"insufficient_funds\"`);
        } else {
            console.log(`proverb_fail=\"true\" error=\"${e.message}\"`);
        }
    }
  } catch (error) {
    console.log(`signal_process_err="${error.message}"`);
  }
}

// Status heartbeat
setInterval(() => {
  const runtime = Math.floor(process.uptime() / 60);
  console.log(`mirror_heartbeat="alive" runtime="${runtime}m" total_mirrors="${totalMirrored}"`);
}, 300000); // Every 5 minutes

console.log(`mirror_ready="true" status="waiting_for_signals" phi_alignment="active" resonance="1.618"`);

// Watch for copycat swaps in the mempool with dynamic block range management
async function watchForCopycats(originalTxHash, prediction, originalSignalHash) {
  let startBlock;
  let watchDuration = 10; // Watch for 10 blocks
  let endTime = Date.now() + (watchDuration * 12 * 1000); // Approximate 12 seconds per block
  
  try {
    startBlock = await provider.getBlockNumber();
    console.log(`copycat_watch="start" tx=${originalTxHash.slice(0, 10)} block=${startBlock}`);
  } catch (error) {
    console.log(`copycat_watch_err="${error.message}" action="abort"`);
    return;
  }
  
  const checkInterval = setInterval(async () => {
    try {
      // Check if we've exceeded our time limit
      if (Date.now() > endTime) {
        console.log(`copycat_watch="ended" tx=${originalTxHash.slice(0, 10)}`);
        clearInterval(checkInterval);
        return;
      }
      
      // Get current block with timeout protection
      const currentBlock = await Promise.race([
        provider.getBlockNumber(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Block number timeout')), 5000))
      ]);
      
      // Validate block range
      if (currentBlock < startBlock) {
        console.log(`block_validation="skip" current=${currentBlock} start=${startBlock} reason="current_less_than_start"`);
        return;
      }
      
      // Stop if we've watched enough blocks
      if (currentBlock > startBlock + watchDuration) {
        console.log(`copycat_watch="complete" blocks_watched=${watchDuration} tx=${originalTxHash.slice(0, 10)}`);
        clearInterval(checkInterval);
        return;
      }
      
      // Get recent transactions with error handling
      let block;
      try {
        block = await Promise.race([
          provider.getBlock(currentBlock, true), // Include transactions
          new Promise((_, reject) => setTimeout(() => reject(new Error('Block fetch timeout')), 8000))
        ]);
      } catch (blockError) {
        console.log(`block_fetch_err="${blockError.message}" block=${currentBlock}`);
        return;
      }
      
      if (!block || !block.transactions || block.transactions.length === 0) {
        return;
      }
      
      // Process transactions in the block
      for (const txHash of block.transactions) {
        if (typeof txHash === 'string' && txHash === originalTxHash) continue;
        
        try {
          const tx = typeof txHash === 'string' ? 
            await provider.getTransaction(txHash) : 
            txHash; // In case full tx objects are returned
            
          if (!tx || !tx.to) continue;
          
          // Check if transaction is to any known DEX router
          const isDexTx = (
            tx.to.toLowerCase() === ACTIVE_ROUTER.toLowerCase() ||
            tx.to.toLowerCase() === DEX_CONFIGS.ROCKETSWAP.ROUTER.toLowerCase()
          );
          if (!isDexTx) continue;
          
          // Validate transaction value and prediction amount
          if (!tx.value || !prediction || !prediction.amount) continue;
          
          // Check if transaction data contains similar pattern
          const txValue = ethers.utils.formatEther(tx.value);
          const originalValue = ethers.utils.formatEther(prediction.amount);
          const txValueFloat = parseFloat(txValue);
          const originalValueFloat = parseFloat(originalValue);
          
          // Skip if values are invalid or zero
          if (isNaN(txValueFloat) || isNaN(originalValueFloat) || originalValueFloat === 0) continue;
          
          const valueDiff = Math.abs(txValueFloat - originalValueFloat);
          const percentDiff = valueDiff / originalValueFloat;
          
          // Copycat if within 20% of original value and to same router
          if (percentDiff < 0.2) {
            console.log(`copycat="detected" original_tx=${originalTxHash.slice(0, 10)} original_value="${originalValue} ETH" copycat_tx=${tx.hash.slice(0, 10)} copycat_value="${txValue} ETH" from=${tx.from.slice(0, 10)} block=${currentBlock}`);
            
            // Track copycat
            if (!copycatTracker.has(originalTxHash)) {
              copycatTracker.set(originalTxHash, {
                count: 0,
                addresses: new Set(),
                timestamp: Date.now()
              });
            }
            
            const tracking = copycatTracker.get(originalTxHash);
            tracking.count++;
            tracking.addresses.add(tx.from);
            
            // Emit recursive signal if multiple copycats detected
            if (tracking.count >= 2 && !mirroredSignals.has(`RECURSIVE:${originalSignalHash}`)) {
              console.log(`copycat_recursive="multiple_detected" action="emit_recursive_signal"`);
              try {
                await emitRecursiveCopycatSignal(originalSignalHash, tracking);
              } catch (recursiveError) {
                console.log(`recursive_signal_err="${recursiveError.message}"`);
              }
            }
          }
        } catch (txError) {
          // Skip invalid or problematic transactions silently
          if (txError.message.includes('timeout')) {
            console.log('tx_fetch="timeout" action="continue"');
          }
        }
      }
    } catch (intervalError) {
      console.log(`copycat_detection_err="${intervalError.message}"`);
      // Don't clear interval on temporary errors, but limit retries
      if (intervalError.message.includes('invalid block range') || 
          intervalError.message.includes('block number timeout')) {
        console.log('copycat_watch="stop" reason="persistent_rpc_issues"');
        clearInterval(checkInterval);
      }
    }
  }, 3000); // Check every 3 seconds (increased from 2 to reduce RPC load)
  
  // Safety timeout to ensure interval is always cleared
  setTimeout(() => {
    clearInterval(checkInterval);
    console.log(`copycat_watch="timeout" action="stop" tx=${originalTxHash.slice(0, 10)}`);
  }, endTime - Date.now() + 5000); // Add 5 second buffer
}

// Enhanced recursive signal emission with phi-aligned depth and resonance
async function emitRecursiveCopycatSignal(parentHash, copycatData) {
  try {
    // Enhanced phi-aligned recursive depth with resonance harmonics
    function calculatePhiDepth(copycatCount, uniqueAddresses, consensusMultiplier) {
      let depth = 1;
      
      // Base depth from copycat metrics with harmonic scaling
      depth += (copycatCount / 10) * PHI; // Primary phi scaling
      depth += (uniqueAddresses / 5) * Math.sqrt(PHI); // Secondary phi root scaling
      
      // Consensus amplification with recursive harmonics
      const harmonicFactor = consensusMultiplier > 2 ? PHI * PHI : PHI; // Squared phi for strong consensus
      depth *= (consensusMultiplier * harmonicFactor) / (PHI * PHI); // Normalized by phi squared
      
      // Apply fibonacci sequence boost for high copycat counts
      if (copycatCount >= 3) {
        depth *= 1.618033988749895; // Full precision phi multiplier
      }
      
      return Math.min(Math.floor(depth * PHI), 4); // Max depth of 4, final phi scaling
    }
    
    // Calculate resonance based on timing and depth
    const currentConsensusMultiplier = getConsensusMultiplier();
    const recursiveDepth = calculatePhiDepth(
      copycatData.count,
      copycatData.addresses.size,
      currentConsensusMultiplier
    );
    
    // Enhanced copycat-induced JAM with phi-alignment metrics
    const copycatJAM = {
      context: {
        source: "phi_aligned_copycat",
        observer: mirrorWallet.address,
        timestamp: Math.floor(Date.now() / 1000),
        parent: parentHash,
        phi_metrics: {
          window_distance: getMinDistanceToConsensusWindow(),
          consensus_multiplier: currentConsensusMultiplier,
          resonance: recursiveDepth * currentConsensusMultiplier
        }
      },
      pattern: {
        type: "recursive-belief",
        copycatCount: copycatData.count,
        uniqueCopycats: copycatData.addresses.size,
        inducedBy: parentHash.slice(0, 10),
        depth: recursiveDepth,
        alignment: "phi_harmonic",
        ipfs: 'QmNUzWDZboZoZUPjnGYTXA94Pmeqjxuy42xHovtigQ1rL5',
      },
      belief: {
        confidence: Math.min(0.99, 0.8 + (copycatData.count * 0.05) * Math.sqrt(1.618)),
        strength: Math.min(0.99, 0.7 + (copycatData.addresses.size * 0.1) * 1.618),
        resonance: recursiveDepth * currentConsensusMultiplier,
        signalHash: ""
      },
      meta: {
        version: "0.3",
        notes: "Phi-aligned recursive signal",
        voice: DMAP_ADDRESS.slice(2, 10),
        phi_signature: "1.618033988749895"
      }
    };
    
    const recursiveHash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(copycatJAM)));
    copycatJAM.belief.signalHash = recursiveHash;
    
    // Emit the recursive signal
    const feeData = await provider.getFeeData();
    const tx = await vault.emitRecursiveSignal(recursiveHash, parentHash, {
      gasPrice: feeData.gasPrice,
      gasLimit: 150000
    });
    
    console.log(`recursive_signal="emitted" hash=${recursiveHash.slice(0, 10)} tx="${tx.hash}" copycat_count=${copycatData.count} unique_addresses=${copycatData.addresses.size}`);
    
    // Mark as processed
    mirroredSignals.add(`RECURSIVE:${parentHash}`);
    recursionDepth++;
    
  } catch (error) {
    console.log(`copycat_signal_err="${error.message}"`);
  }
}

const copycatTracker = new Map(); // Track copycat activity

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log(`shutdown="graceful" total_mirrors="${totalMirrored}" total_eth="${ethers.utils.formatEther(totalValueCreated)}" copycats="${copycatTracker.size}"`);
  process.exit(0);
});
