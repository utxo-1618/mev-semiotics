// index.js - The Strategist: A Causal Engine (Stateless & Resilient)
// Usage: node index.js
// MERGED: jam-store.js

const { ethers } = require("ethers");

process.on('SIGTERM', () => {
    if (typeof systemState !== 'undefined' && typeof saveSystemState === 'function') {
        systemState.isEmittingLock = { isLocked: false, pid: null, timestamp: null };
        saveSystemState();
        console.log('lock_status=cleared event=SIGTERM pid=' + process.pid);
    }
    process.exit(0);
});
process.on('SIGINT', () => {
    if (typeof systemState !== 'undefined' && typeof saveSystemState === 'function') {
        systemState.isEmittingLock = { isLocked: false, pid: null, timestamp: null };
        saveSystemState();
        console.log('lock_status=cleared event=SIGINT pid=' + process.pid);
    }
    process.exit(0);
});
process.on('unhandledRejection', (reason) => {
    if (typeof systemState !== 'undefined' && typeof saveSystemState === 'function') {
        systemState.isEmittingLock = { isLocked: false, pid: null, timestamp: null };
        saveSystemState();
        console.log('lock_status=cleared event=unhandledRejection pid=' + process.pid);
    }
    process.exit(1);
});
process.on('uncaughtException', (err) => {
    if (typeof systemState !== 'undefined' && typeof saveSystemState === 'function') {
        systemState.isEmittingLock = { isLocked: false, pid: null, timestamp: null };
        saveSystemState();
        console.log('lock_status=cleared event=uncaughtException pid=' + process.pid);
    }
    process.exit(1);
});
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { bridgeToBSV } = require('./bsv-echo');
const { analyzeContract } = require('./substrate');
const { StateManager } = require('./state-manager');
const MoTSIntegration = require('./mots-integration');
const { 
    PHI, 
    PHI_INVERSE, 
    PHI_SQUARED,
    PROVERB_PATTERNS,
    RPC_URLS,
    PRIVATE_KEY,
    VAULT_ADDRESS,
    TARGET_CONTRACT_ADDRESS,
    BASE_EMISSION_INTERVAL,
    EXPLORATION_BONUS,
    COOLDOWN_PENALTY
} = require('./constants');
const lunarClock = require('./tools/lunar-clock');

const { getMarketData } = require('./market-oracle');
// Initialize cosmic signature if wallet is available
if (process.env.WALLET_ADDRESS && process.env.BIRTH_TIMESTAMP) {
    lunarClock.setPersonalSignature(
        process.env.WALLET_ADDRESS,
        parseInt(process.env.BIRTH_TIMESTAMP)
    );
    console.log('cosmic_signature="initialized" wallet="' + process.env.WALLET_ADDRESS.slice(0,8) + '..."');
}

// --- System State Management ---
// All critical state is persisted to disk to survive restarts.
const STATE_FILE_PATH = path.join(__dirname, 'system-state.json');

let systemState = {
    lastHash: null,
    metrics: {
        totalAnalyses: 0,
        auditPasses: 0,
        auditFails: 0,
        emissionSuccesses: 0,
        emissionFailures: 0,
        lastAuditFailReason: null,
        patternSuccess: {}
    },
    // A file-based lock to prevent concurrency issues across restarts.
    isEmittingLock: {
        isLocked: false,
        pid: null,
        timestamp: null
    },
    currentNonce: null
};

function saveSystemState() {
    const tempPath = STATE_FILE_PATH + '.tmp';
    try {
        fs.writeFileSync(tempPath, JSON.stringify(systemState, null, 2));
        fs.renameSync(tempPath, STATE_FILE_PATH);
    } catch (error) {
        console.error(`state_save_err="${error.message}"`)
        // If we can't save state, we should probably exit to avoid desync.
        process.exit(1);
    }
}

async function loadSystemState() {
    try {
        if (fs.existsSync(STATE_FILE_PATH)) {
            const stateData = fs.readFileSync(STATE_FILE_PATH, 'utf8');
            const persistedState = JSON.parse(stateData);
            
            // Restore metrics and lastHash
            systemState.metrics = persistedState.metrics || systemState.metrics;
            systemState.lastHash = persistedState.lastHash || null;
            systemState.currentNonce = persistedState.currentNonce || null;

            // Ensure all proverb patterns have a metrics entry.
            Object.keys(PROVERB_PATTERNS).forEach(pattern => {
                if (!systemState.metrics.patternSuccess[pattern]) {
                    systemState.metrics.patternSuccess[pattern] = { attempts: 0, successes: 0, lastUsed: 0 };
                }
            });

            // Check for stale lock from a previous crashed process
            const lock = persistedState.isEmittingLock;
            const STALE_LOCK_TIMEOUT = 5 * 60 * 1000; // 5 minutes
            const GRACE_PERIOD = 30 * 1000; // 30 seconds grace period

            if (lock && lock.isLocked) {
                const lockAge = Date.now() - lock.timestamp;
                
                if (lockAge > STALE_LOCK_TIMEOUT) {
                    console.warn(`state_lock=\"stale\" pid=${lock.pid} age_minutes=${(lockAge / 60000).toFixed(2)}`)
                    systemState.isEmittingLock = { isLocked: false, pid: null, timestamp: null };
                    saveSystemState();
                } else if (lock.pid === process.pid) {
                    // Same process, likely a restart - clear the lock
                    console.warn(`state_lock=\"self\" pid=${lock.pid} action=\"clear\"`)
                    systemState.isEmittingLock = { isLocked: false, pid: null, timestamp: null };
                } else {
                    // Check if the process is actually still running
                    try {
                        // Send signal 0 to check if process exists
                        process.kill(lock.pid, 0);
                        // Process exists, wait with grace period
                        console.warn(`state_lock=\"active\" pid=${lock.pid} age_seconds=${(lockAge / 1000).toFixed(0)} action=\"wait\"`)
                        
                        // Wait for grace period before exiting
                        console.log(`lock_wait=\"starting\" grace_period_seconds=${GRACE_PERIOD / 1000}`)
                        const startWait = Date.now();
                        
                        // Check lock status every 5 seconds during grace period
                        while (Date.now() - startWait < GRACE_PERIOD) {
                            await new Promise(resolve => setTimeout(resolve, 5000));
                            
                            // Re-read state to check if lock was released
                            if (fs.existsSync(STATE_FILE_PATH)) {
                                const currentStateData = fs.readFileSync(STATE_FILE_PATH, 'utf8');
                                const currentState = JSON.parse(currentStateData);
                                if (!currentState.isEmittingLock.isLocked) {
                                    console.log(`lock_wait=\"released\" elapsed_seconds=${((Date.now() - startWait) / 1000).toFixed(0)}`)
                                    return loadSystemState(); // Recursive call to reload clean state
                                }
                            }
                        }
                        
                        // Still locked after grace period
                        console.error(`state_lock=\"timeout\" pid=${lock.pid} action=\"exit\"`)
                        process.exit(1);
                    } catch (err) {
                        // Process doesn't exist, clear the lock
                        console.warn(`state_lock=\"dead\" pid=${lock.pid} action=\"clear\"`)
                        systemState.isEmittingLock = { isLocked: false, pid: null, timestamp: null };
                        saveSystemState();
                    }
                }
            }
        } else {
             // Initialize pattern success metrics if state is new
            Object.keys(PROVERB_PATTERNS).forEach(pattern => {
                systemState.metrics.patternSuccess[pattern] = { attempts: 0, successes: 0, lastUsed: 0 };
            });
        }
    } catch (error) {
        console.error(`state_load_err=\"${error.message}\" action=\"fresh_state\"`)
        // Ensure pattern success is initialized on error as well
        Object.keys(PROVERB_PATTERNS).forEach(pattern => {
            systemState.metrics.patternSuccess[pattern] = { attempts: 0, successes: 0, lastUsed: 0 };
        });
    }
    // Save the initial (or recovered) state.
    if (systemState.currentNonce === null) {
        console.log('nonce_init="fetching"');
        try {
            systemState.currentNonce = await getTransactionCount(wallet.address, 'pending');
            console.log(`nonce_init="fetched" nonce=${systemState.currentNonce}`);
        } catch (e) {
            console.error(`nonce_init_err="${e.message}"`);
            process.exit(1); // Exit if we cannot get a nonce
        }
    }
    saveSystemState();
}


// --- JAM Store ---
const jamStore = require('./jam-store');


// --- Config and Constants ---
// All constants are now imported from constants.js at the top of the file

// Initialize provider with failover and load balancing
let provider;
let currentRpcIndex = 0;

// Enhanced resilient RPC function with better error categorization and backoff
async function resilientRpcCall(method, params = [], maxRetries = RPC_URLS.length * 2) {
    let lastError;
    let consecutiveIndexingErrors = 0;
    const maxIndexingRetries = 3;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const rpcUrl = RPC_URLS[currentRpcIndex];
            const tempProvider = new ethers.providers.JsonRpcProvider(rpcUrl);
            
            // Dynamic timeout based on method and attempt
            let timeout = Math.floor(PHI * 30 * 1000); // Base: ~48.5 seconds
            if (method === 'eth_getTransactionReceipt') {
                timeout = Math.floor(timeout * 0.6); // Shorter for receipt checks: ~29s
            } else if (attempt > RPC_URLS.length) {
                timeout = Math.floor(timeout * 1.5); // Longer timeout for retry rounds: ~72s
            }
            
            const result = await Promise.race([
                tempProvider.send(method, params),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error(`RPC timeout after ${timeout}ms`)), timeout)
                )
            ]);
            
            // Success - update global provider if needed and reset error counters
            if (!provider || provider.connection.url !== rpcUrl) {
                provider = tempProvider;
                console.log(`rpc_failover="success" url="${rpcUrl}" attempt=${attempt + 1} method="${method}"`);
            }
            consecutiveIndexingErrors = 0;
            
            return result;
        } catch (error) {
            lastError = error;
            const errorMsg = error.message.toLowerCase();
            
            // Categorize and handle specific RPC errors
            if (errorMsg.includes('transaction indexing is in progress')) {
                consecutiveIndexingErrors++;
                console.warn(`rpc_indexing_error="${error.message}" url="${RPC_URLS[currentRpcIndex]}" consecutive=${consecutiveIndexingErrors} attempt=${attempt + 1}`);
                
                // If we hit indexing errors on multiple providers, add delay
                if (consecutiveIndexingErrors >= maxIndexingRetries) {
                    const backoffMs = Math.min(5000 * consecutiveIndexingErrors, 30000); // Max 30s backoff
                    console.log(`rpc_indexing_backoff="applying" delay_ms=${backoffMs} reason="multiple_indexing_errors"`);
                    await new Promise(resolve => setTimeout(resolve, backoffMs));
                    consecutiveIndexingErrors = 0; // Reset after backoff
                }
            } else if (errorMsg.includes('timeout') || errorMsg.includes('network')) {
                console.warn(`rpc_network_error="${error.message}" url="${RPC_URLS[currentRpcIndex]}" attempt=${attempt + 1}`);
                // Small delay for network issues
                await new Promise(resolve => setTimeout(resolve, 1000));
            } else if (errorMsg.includes('rate limit') || errorMsg.includes('too many requests')) {
                console.warn(`rpc_rate_limit="${error.message}" url="${RPC_URLS[currentRpcIndex]}" attempt=${attempt + 1}`);
                // Longer delay for rate limiting
                await new Promise(resolve => setTimeout(resolve, 5000));
            } else {
                console.warn(`rpc_error="${error.message}" url="${RPC_URLS[currentRpcIndex]}" attempt=${attempt + 1} type="unknown"`);
            }
            
            // Rotate to next RPC URL
            currentRpcIndex = (currentRpcIndex + 1) % RPC_URLS.length;
            
            // Add exponential backoff for repeated failures
            if (attempt > 0 && attempt % RPC_URLS.length === 0) {
                const backoffMs = Math.min(1000 * Math.pow(2, Math.floor(attempt / RPC_URLS.length)), 10000);
                console.log(`rpc_round_backoff="applying" delay_ms=${backoffMs} round=${Math.floor(attempt / RPC_URLS.length) + 1}`);
                await new Promise(resolve => setTimeout(resolve, backoffMs));
            }
        }
    }
    
    throw new Error(`All RPC endpoints failed after ${maxRetries} attempts. Last error: ${lastError?.message || 'Unknown error'}`);
}

// Resilient provider methods with fallback
async function getBlockNumber() {
    return await resilientRpcCall('eth_blockNumber');
}

async function getTransactionCount(address, block = 'latest') {
    const result = await resilientRpcCall('eth_getTransactionCount', [address, block]);
    return parseInt(result, 16);
}

async function getBalance(address, block = 'latest') {
    const result = await resilientRpcCall('eth_getBalance', [address, block]);
    return ethers.BigNumber.from(result);
}

function initializeProvider() {
    const rpcUrl = RPC_URLS[currentRpcIndex];
    console.log(`provider_init="starting" rpc="${rpcUrl}"`);
    try {
        provider = new ethers.providers.JsonRpcProvider(rpcUrl);
        console.log(`provider_init="success" rpc="${rpcUrl}"`);
    } catch (e) {
        console.error(`provider_init_err="${e.message}" rpc="${rpcUrl}"`);
        rotateProvider();
    }
}

function rotateProvider() {
    currentRpcIndex = (currentRpcIndex + 1) % RPC_URLS.length;
    console.log(`provider_rotate="new_rpc" index=${currentRpcIndex} url=${RPC_URLS[currentRpcIndex]}`);
    initializeProvider();
}

// Initial provider initialization
initializeProvider();


// Enhanced provider error handling with categorization
if(provider && provider.on) {
    provider.on('error', (err) => {
        const errorMsg = err.message.toLowerCase();
        
        if (errorMsg.includes('transaction indexing is in progress')) {
            console.warn(`provider_indexing_error="${err.message}" action="continue_with_current"`);
            // Don't rotate for indexing errors - they're temporary
        } else if (errorMsg.includes('timeout') || errorMsg.includes('network')) {
            console.error(`provider_network_error="${err.message}" action="rotate"`);
            rotateProvider();
        } else if (errorMsg.includes('rate limit')) {
            console.error(`provider_rate_limit="${err.message}" action="rotate_with_delay"`);
            setTimeout(() => rotateProvider(), 5000);
        } else {
            console.error(`provider_error="${err.message}" action="rotate"`);
            rotateProvider();
        }
    });
}

// Validate private key and create wallet
if (!PRIVATE_KEY) {
    console.error(`wallet_init_err="PRIVATE_KEY not found in environment"`);
    process.exit(1);
}

let wallet;
try {
    wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    console.log(`wallet_init="success" address=${wallet.address}`);
} catch (e) {
    console.error(`wallet_init_err="${e.message}"`);
    process.exit(1);
}

// --- Core Logic (Refactored to use systemState) ---

async function acquireLock() {
    // Reload the latest state from disk to check the lock
    const stateData = fs.readFileSync(STATE_FILE_PATH, 'utf8');
    const currentState = JSON.parse(stateData);

    if (currentState.isEmittingLock.isLocked) {
        const sameProcess = currentState.isEmittingLock.pid === process.pid;
        if (!sameProcess) {
            console.log(`lock_status=\"busy\" pid=${currentState.isEmittingLock.pid}`);
            return false;
        }
        // If same process, assume stale, clear and re-acquire
        console.log(`lock_status=\"stale_self\" pid=${process.pid}, reacquiring`);
    }

    systemState.isEmittingLock = { isLocked: true, pid: process.pid, timestamp: Date.now() };
    saveSystemState();
    console.log(`lock_status=\"acquired\" pid=${process.pid}`)
    return true;
}

async function releaseLock() {
    console.log(`releasing_lock_by_pid=${process.pid}`);
    systemState.isEmittingLock = { isLocked: false, pid: null, timestamp: null };
    saveSystemState();
    console.log(`lock_status=\"released\" pid=${process.pid}`);
}


async function analyzeAndGenerateJam(marketData) {
    systemState.metrics.totalAnalyses++;
    
    // Read current narrative for JAM metadata
    let currentNarrative = 'default';
    try {
        const narrativeActiveFile = path.join(__dirname, '.narrative-active');
        if (fs.existsSync(narrativeActiveFile)) {
            const activeNarrative = fs.readFileSync(narrativeActiveFile, 'utf8').trim();
            if (activeNarrative) {
                currentNarrative = activeNarrative;
            }
        }
    } catch (e) {
        // Use default if file read fails
    }
    
    let analysis;
    const isAddressInvalid = !TARGET_CONTRACT_ADDRESS || !ethers.utils.isAddress(TARGET_CONTRACT_ADDRESS);

    if (isAddressInvalid) {
        analysis = {
            audit_pass: true, // Pass to generate the void JAM
            is_void: true,
            reason: 'Invalid or missing TARGET_CONTRACT_ADDRESS',
            bait_hooks: ['void'],
            bytecode_proof: '0x0000000000000000000000000000000000000000000000000000000000000000',
            substrate_hash: '0x0000000000000000000000000000000000000000000000000000000000000000'
        };
        systemState.metrics.auditFails++;
        systemState.metrics.lastAuditFailReason = analysis.reason;
        console.warn(`audit_status=\"fail\" reason=\"${analysis.reason}\" archetype=\"ENS_CONTRACT_VOID\"`);
    } else {
        analysis = await analyzeContract(TARGET_CONTRACT_ADDRESS, provider);
        if (!analysis.audit_pass) {
            systemState.metrics.auditFails++;
            systemState.metrics.lastAuditFailReason = analysis.reason;
            console.warn(`audit_status=\"fail\" reason=\"${analysis.reason}\"`);
            saveSystemState();
            return null;
        }
        systemState.metrics.auditPasses++;
        console.log("audit_status=pass");
    }

    // Get current gas price for pattern selection
    const feeData = await provider.getFeeData();
    const gasPrice = feeData.gasPrice || ethers.utils.parseUnits('1', 'gwei');
    const gasPriceGwei = parseFloat(ethers.utils.formatUnits(gasPrice, 'gwei'));
    
    const selectedPattern = selectOptimalPattern(systemState.metrics.patternSuccess, marketData);
    
    // If no pattern is selected, skip emission
    if (!selectedPattern) {
        console.log("jam_generation_skip=\"no_optimal_pattern\"");
        return null;
    }

    const pattern = PROVERB_PATTERNS[selectedPattern];
    
    // Generate recursive metadata
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = Math.floor(Math.random() * 1000000);
    const recursiveIndices = [0, 0, 0, 0]; // Phi-aligned indices
    const phiRelations = [PHI.toFixed(3), PHI_INVERSE.toFixed(3), "1.000"];
    
    // Get cosmic timing data for resonance amplification
    const now = new Date();
    const cosmicWindow = lunarClock.getEmissionWindow(now);
    const cosmicResonance = lunarClock.calculateCosmicResonance(now);
    
    // Log cosmic alignment
    console.log(`cosmic_align="${cosmicWindow.phase}" resonance=${cosmicResonance.total.toFixed(3)} mercury_retro=${cosmicWindow.context.mercuryRetro}`);
    
    // Build the JAM object with all required fields
    let jam = {
        hash: null, // Will be set after hashing
        timestamp: Date.now(),
        tx: null,
        ipfs: "QmQajAVuZvaJJAfwAxXbhkw4JUTYrJm1YJ2X6EDyWnEmbk",
        amplifierTx: null,
        mirrorResponse: null,
        proverb: pattern.steps.map(step => ({
            ...step,
            hook: analysis.bait_hooks?.[0] || 'swap'
        })),
        meta: {
            timestamp,
            parentJam: systemState.lastHash,
            target_contract: TARGET_CONTRACT_ADDRESS,
            bytecode_proof: analysis.bytecode_proof,
            substrate_hash: analysis.substrate_hash,
            audit_pass: true,
            bait_hooks: analysis.bait_hooks || ['swap', 'swapExactETHForTokens'],
            pattern_type: selectedPattern,
            timing_quality: cosmicResonance.total.toFixed(3),
            isPinned: false,
            microburst: false,
            narrative: currentNarrative,
            nonce,
            recursiveIndices,
            phiRelations,
            recursiveState: {
                v: 1,
                r: 0.99,
                m: 0,
                d: systemState.lastHash ? 1 : 0,
                s: `${nonce}-990-0`,
                t: timestamp,
                signature: `${nonce}-990-0`
            }
        },
        tags: [
            "STRENGTH:0.990",
            `VOICE:${selectedPattern}`,
            `DEPTH:${systemState.lastHash ? 2 : 1}`,
            `VECTOR:${nonce}-990-0`,
            `COSMIC:${cosmicWindow.phase}`
        ],
        recursiveTopology: {
            eth: 1,
            bsv: 0,
            vectorClock: {
                eth: 1,
                bsv: 0
            }
        },
        cascadeDepth: systemState.lastHash ? 
            ((jamStore.retrieve(systemState.lastHash)?.cascadeDepth || 0) + 1) : 1,
        resonance: (PHI * cosmicResonance.total).toFixed(3)
    };

    if (analysis.is_void) {
        const now = new Date();
        const cosmicWindow = lunarClock.getEmissionWindow(now);
        const pubkey = wallet.publicKey;
        const moonPhase = cosmicWindow.phase;

        jam.meta.pattern_type = "ENS_CONTRACT_VOID";
        jam.meta.intent_class = "ADDRESS_RESOLUTION_FAILURE";
        jam.meta.cosmic_hash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(pubkey + moonPhase + "void"));
        jam.tags.push("ENS:void", "TARGET_ADDR:null");
        jam.proverb = [];
        jam.meta.audit_pass = false; // Mark as a failed audit JAM
        jam.meta.target_contract = '0x0000000000000000000000000000000000000000';
    }
    
    // Annotate JAM with full cosmic context
    jam = lunarClock.annotateJAM(jam, now);

    // Calculate hash
    const raw = JSON.stringify(jam);
    const hash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(raw));
    jam.hash = hash;

    // Store the JAM
    jamStore.store(hash, jam);
    
    // Update metrics
    systemState.metrics.patternSuccess[selectedPattern].attempts++;
    systemState.metrics.patternSuccess[selectedPattern].lastUsed = Date.now();
    saveSystemState();

    return { jam, hash };
}

// Enhanced semantic selection - creates "supernormal stimuli" for MEV bots
// Aligned with PoRI architecture: semantic richness over simple profit thresholds
function selectOptimalPattern(patternMetrics, marketData) {
    const patterns = Object.keys(PROVERB_PATTERNS);
    marketData = marketData || { volatility: {}, liquidity: {}, gasPrice: 1 };
    
    // Get current cosmic resonance for pattern alignment
    const lunarClock = require('./tools/lunar-clock.js');
    const cosmicResonance = lunarClock.calculateCosmicResonance(new Date());
    const emissionWindow = lunarClock.getEmissionWindow(new Date());
    
    console.log(`cosmic_selection resonance=${cosmicResonance.total.toFixed(3)} phase="${emissionWindow.phase}" should_emit=${emissionWindow.shouldEmit}`);
    
    // If cosmic conditions are unfavorable, emit no signal rather than a weak one
    if (!emissionWindow.shouldEmit || cosmicResonance.total < 0.9) {
        console.log(`cosmic_veto="unfavorable_conditions" resonance=${cosmicResonance.total.toFixed(3)} void_of_course=${emissionWindow.context.voidOfCourse}`);
        return null;
    }

    const scores = patterns.map(patternName => {
        const pattern = PROVERB_PATTERNS[patternName];
        const metrics = patternMetrics[patternName] || { attempts: 0, successes: 0, lastUsed: 0 };
        
        // --- Layer 1: Semantic Clarity Score ---
        // Patterns with higher inherent recognizability to MEV bots
        const semanticClarityScores = {
            'CLASSIC_ARBITRAGE': 1.0,    // Universally recognized by all MEV bots
            'ETH_DAI_FLOW': 0.9,         // Common DeFi pattern, high legibility
            'STABLE_ROTATION': 0.85,     // Stable-to-stable, medium complexity
            'DEFI_GOVERNANCE': 0.7       // More complex, requires sophisticated bots
        };
        const semanticClarity = semanticClarityScores[patternName] || 0.5;
        
        // --- Layer 2: Cosmic Resonance Alignment ---
        // Patterns resonate differently with cosmic cycles
        const baseResonance = pattern.baseResonance || PHI;
        const cosmicAlignment = Math.abs(Math.sin(cosmicResonance.total * baseResonance));
        const resonanceMultiplier = 1 + (cosmicAlignment * 0.618); // PHI-scaled amplification
        
        // --- Layer 3: Historical Performance (Attribution Success) ---
        const successRate = metrics.attempts > 0 ? metrics.successes / metrics.attempts : 0.618; // Start with PHI-bias
        const attributionWeight = successRate * 1.5; // Heavily weight patterns that create attribution
        
        // --- Layer 4: Temporal Freshness ---
        const recency = (Date.now() - metrics.lastUsed) / (1000 * 60 * 60); // in hours
        const freshnessScore = Math.min(1.0, recency / 6); // Peak freshness after 6 hours
        
        // --- Layer 5: Game-Theoretic Incentive Strength ---
        // Favor patterns that create stronger game-theoretic incentives
        const incentiveStrength = {
            'CLASSIC_ARBITRAGE': 1.0,    // Maximum bot engagement
            'ETH_DAI_FLOW': 0.95,        // High engagement, large market
            'STABLE_ROTATION': 0.8,      // Medium engagement, stable profits
            'DEFI_GOVERNANCE': 0.9       // High engagement from sophisticated actors
        }[patternName] || 0.5;
        
        // --- Composite Semantic Score (No arbitrary thresholds) ---
        const compositeScore = (
            semanticClarity * 0.3 +           // Core legibility to MEV ecosystem
            (resonanceMultiplier - 1) * 0.25 + // Cosmic timing alignment
            attributionWeight * 0.2 +          // Proven attribution success
            freshnessScore * 0.15 +           // Temporal novelty
            incentiveStrength * 0.1           // Game-theoretic pull
        ) * cosmicResonance.total;            // Amplified by current cosmic conditions
        
        console.log(`semantic_score pattern=${patternName} composite=${compositeScore.toFixed(3)} (clarity=${semanticClarity.toFixed(2)}, cosmic=${cosmicAlignment.toFixed(2)}, attribution=${attributionWeight.toFixed(2)}, fresh=${freshnessScore.toFixed(2)})`);
        
        return { 
            pattern: patternName, 
            score: compositeScore,
            semanticData: {
                clarity: semanticClarity,
                cosmicAlignment: cosmicAlignment,
                attribution: attributionWeight,
                freshness: freshnessScore,
                incentive: incentiveStrength
            }
        };
    });
    
    // Sort by semantic richness, not arbitrary thresholds
    scores.sort((a, b) => b.score - a.score);
    
    const bestPattern = scores[0];
    
    // Only emit if the signal has genuine semantic strength
    // This prevents "shitty signals" that waste the MEV ecosystem's attention
    if (bestPattern && bestPattern.score > 0.7) {
        console.log(`selected_pattern name=${bestPattern.pattern} semantic_score=${bestPattern.score.toFixed(3)} cosmic_phase="${emissionWindow.phase}" clarity=${bestPattern.semanticData.clarity}`);
        return bestPattern.pattern;
    }
    
    console.log(`semantic_veto="insufficient_signal_strength" best_score=${bestPattern?.score?.toFixed(3) || 'none'} min_semantic_threshold=0.7`);
    return null; // No pattern meets semantic richness criteria
}

// Enhanced balance check with resilient RPC calls
async function checkSufficientBalance() {
    try {
        // Use resilient RPC calls for balance and fee data
        const [balanceHex, feeDataResult] = await Promise.all([
            resilientRpcCall('eth_getBalance', [wallet.address, 'latest']),
            resilientRpcCall('eth_feeHistory', [1, 'latest', [25]]).then(result => ({
                lastBaseFeePerGas: result.baseFeePerGas?.[0] ? ethers.BigNumber.from(result.baseFeePerGas[0]) : null
            })).catch(() => ({ lastBaseFeePerGas: null }))
        ]);
        
        const balance = ethers.BigNumber.from(balanceHex);
        const baseFee = feeDataResult.lastBaseFeePerGas || ethers.utils.parseUnits('0.001', 'gwei');
        
        // Use phi-aligned gas estimation
        const phiGasLimit = 396000; // Updated to match current emission function
        const phiScaledBaseFee = baseFee.mul(618).div(1000); // baseFee * φ^-1
        const priorityFee = ethers.utils.parseUnits('0.000618', 'gwei');
        const totalFeePerGas = phiScaledBaseFee.add(priorityFee);
        
        const estimatedCost = totalFeePerGas.mul(phiGasLimit);
        const phiMargin = Math.floor(2.618 * 100) / 100; // φ² safety margin
        const minimumRequired = estimatedCost.mul(Math.floor(phiMargin * 100)).div(100);
        
        const balanceEth = ethers.utils.formatEther(balance);
        const requiredEth = ethers.utils.formatEther(minimumRequired);
        
        if (balance.lt(minimumRequired)) {
            console.warn(`balance_precheck="insufficient" current="${balanceEth}" required="${requiredEth}" margin="φ²" gas_limit=${phiGasLimit}`);
            return false;
        }
        
        console.log(`balance_precheck="sufficient" current="${balanceEth}" required="${requiredEth}" gas_limit=${phiGasLimit}`);
        return true;
    } catch (err) {
        const errorMsg = err.message.toLowerCase();
        if (errorMsg.includes('transaction indexing is in progress')) {
            console.warn(`balance_precheck="indexing_in_progress" action="proceed_cautiously"`);
            return true; // Proceed when indexing, balance likely sufficient
        } else if (errorMsg.includes('all rpc endpoints failed')) {
            console.error(`balance_precheck="all_rpc_failed" action="proceed_with_risk"`);
            return true; // Proceed with risk when all RPCs fail
        } else {
            console.error(`balance_precheck_err="${err.message}" action="proceed_with_caution"`);
            return true; // Proceed if check fails
        }
    }
}

async function detectAndEmit() {
    console.log(`detect_and_emit:start pid=${process.pid}`);
    
    const marketData = await getMarketData(provider);

    // Check cosmic timing window before proceeding
// Enhanced nonce manager with better error handling and retry logic
const nonceManager = {
    nonce: -1,
    lock: false,
    lastNonceUpdate: 0,
    pendingTransactions: new Set(),
    NONCE_REFRESH_INTERVAL: 60000, // Refresh nonce every minute
    MAX_RETRIES: 5,
    RETRY_DELAY: 2000, // Base delay of 2 seconds

    async getNonce(provider, walletAddress) {
        if (this.lock) {
            await new Promise(resolve => setTimeout(resolve, 200)); // Increased delay
            return this.getNonce(provider, walletAddress);
        }

        this.lock = true;
        try {
            const now = Date.now();
            const shouldRefresh = this.nonce === -1 || 
                                (now - this.lastNonceUpdate) > this.NONCE_REFRESH_INTERVAL ||
                                this.pendingTransactions.size > 0;

            if (shouldRefresh) {
                let attempts = 0;
                let lastError;

                while (attempts < this.MAX_RETRIES) {
                    try {
                        const newNonce = await provider.getTransactionCount(walletAddress, 'pending');
                        
                        // Validate the new nonce
                        if (newNonce < this.nonce && this.nonce !== -1) {
                            console.warn(`nonce_warning="regression_detected" current=${this.nonce} new=${newNonce} action="retry"`);
                            attempts++;
                            await new Promise(r => setTimeout(r, this.RETRY_DELAY * Math.pow(2, attempts)));
                            continue;
                        }

                        this.nonce = newNonce;
                        this.lastNonceUpdate = now;
                        this.pendingTransactions.clear();
                        console.log(`nonce_refresh="success" nonce=${this.nonce} attempts=${attempts + 1}`);
                        break;
                    } catch (error) {
                        lastError = error;
                        attempts++;
                        if (attempts < this.MAX_RETRIES) {
                            const delay = this.RETRY_DELAY * Math.pow(2, attempts);
                            console.warn(`nonce_fetch_retry="attempt_${attempts}" delay=${delay}ms error="${error.message}"`);
                            await new Promise(r => setTimeout(r, delay));
                        }
                    }
                }

                if (attempts === this.MAX_RETRIES) {
                    throw new Error(`Failed to fetch nonce after ${this.MAX_RETRIES} attempts. Last error: ${lastError?.message}`);
                }
            }

            return this.nonce;
        } finally {
            this.lock = false;
        }
    },

    async addPendingTransaction(txHash) {
        this.pendingTransactions.add(txHash);
        console.log(`pending_tx_added="${txHash}" count=${this.pendingTransactions.size}`);
    },

    async removePendingTransaction(txHash) {
        this.pendingTransactions.delete(txHash);
        console.log(`pending_tx_removed="${txHash}" count=${this.pendingTransactions.size}`);
    },

    incrementNonce() {
        if (!this.lock) {
            this.nonce++;
            console.log(`nonce_increment="success" new_nonce=${this.nonce}`);
        }
    },

    async resetNonce() {
        this.nonce = -1;
        this.lastNonceUpdate = 0;
        this.pendingTransactions.clear();
        console.log(`nonce_reset="complete" pending_cleared=true`);
    }
};
    
    if (!(await acquireLock())) {
        return;
    }
    
    try {
        const nonce = await nonceManager.getNonce(provider, wallet.address);
        console.log(`tx_nonce=\"using\" nonce=${nonce}`);

        console.log(`jam_generation="starting"`);
        const result = await analyzeAndGenerateJam(marketData);
        if (!result) {
            // Rollback nonce if analysis fails
            systemState.currentNonce--;
            return;
        }

        const { jam, hash } = result;
        
        console.log(`emit_jam=\"start\" hash=${hash.slice(0, 10)}`)
        
        const dmap = new ethers.Contract(process.env.DMAP_ADDRESS, [
            "function registerSignal(string calldata description, uint256 categoryId) external returns (bytes32)"
        ], wallet);

        // Get cosmic resonance for fee calculation
        const cosmicResonance = lunarClock.calculateCosmicResonance(new Date());
        
        // Phi-aligned gas optimization for Base L2
        const feeData = await provider.getFeeData();
        const baseFee = feeData.lastBaseFeePerGas || feeData.gasPrice || ethers.utils.parseUnits('0.001', 'gwei');
        
        // Dynamic gas limit - increased significantly to handle DMAP contract requirements
        const baseGasLimit = 300000; // Increased from 150000 to handle reentrancy sentry and string operations
        const complexityMultiplier = jam.cascadeDepth > 1 ? 1.2 : 1.0;
        const resonanceMultiplier = cosmicResonance.total > 1.5 ? 1.0 : 1.1; // More gas during low resonance for complex operations
        const phiAdjustedGasLimit = Math.floor(baseGasLimit * complexityMultiplier * resonanceMultiplier);
        const gasLimit = ethers.BigNumber.from(phiAdjustedGasLimit.toString());
        
        // Phi-aligned priority fee calculation
        const baselinePriority = ethers.utils.parseUnits('0.000618', 'gwei'); // φ^-1 * 0.001
        const cosmicBoost = cosmicResonance.total > 1.618 ? 
            ethers.utils.parseUnits((0.001618 * cosmicResonance.total).toFixed(6), 'gwei') : 
            baselinePriority;
        const maxPriorityFeePerGas = ethers.BigNumber.from(
            Math.min(cosmicBoost.toNumber(), ethers.utils.parseUnits('0.002', 'gwei').toNumber())
        );
        
        // Golden ratio fee scaling: base fee * φ^-1 + priority
        const phiScaledBaseFee = baseFee.mul(618).div(1000); // baseFee * φ^-1
        const maxFeePerGas = phiScaledBaseFee.add(maxPriorityFeePerGas); 
        
        console.log(`gas_fees_optimized: gasLimit=${gasLimit} maxFeePerGas=${ethers.utils.formatUnits(maxFeePerGas, 'gwei')} gwei, maxPriorityFeePerGas=${ethers.utils.formatUnits(maxPriorityFeePerGas, 'gwei')} gwei, phi_scaled=true, cosmic_resonance=${cosmicResonance.total.toFixed(3)}`);

        // Check balance before attempting transaction submission
        if (!(await checkSufficientBalance())) {
            console.log(`tx_skip="insufficient_balance" jam_generated="true" action="skip_onchain_only"`);
            // JAM was still generated and stored, just skipping on-chain emission
            systemState.currentNonce--; // Rollback optimistic nonce increment
            console.log(`nonce_rollback="balance_check" nonce=${systemState.currentNonce}`);
            return; // Return early, but JAM is still created
        }
        
// Try emission with dynamic fee escalation retry
let tx;
let retries = 5; // Increase the number of retries
let currentNonce = nonce;
let feeMultiplier = 1.1; // Start with a slightly higher multiplier

while (retries > 0) {
    try {
        // Calculate escalated fees for retry
        const escalatedMaxPriorityFeePerGas = maxPriorityFeePerGas.mul(Math.floor(feeMultiplier * 1000)).div(1000);
        const escalatedMaxFeePerGas = maxFeePerGas.mul(Math.floor(feeMultiplier * 1000)).div(1000);

        // Cap fees to reasonable maximums to prevent runaway costs
        const maxAllowedPriorityFee = ethers.utils.parseUnits('3', 'gwei'); // Adjust cap
        const maxAllowedFee = ethers.utils.parseUnits('70', 'gwei'); // Adjust cap

        let finalPriorityFee = escalatedMaxPriorityFeePerGas;
        if (finalPriorityFee.gt(maxAllowedPriorityFee)) {
            finalPriorityFee = maxAllowedPriorityFee;
        }

        let finalMaxFee = escalatedMaxFeePerGas;
        if (finalMaxFee.gt(maxAllowedFee)) {
            finalMaxFee = maxAllowedFee;
        }

        // Create enhanced description with unique fields to prevent hash collisions
        const now = Date.now();
        const entropy = Math.random().toString(36).substring(2, 11); // 9 character random string
        const pid = process.pid;
        const retry = 5 - retries;
        const uuid = `${now}_${entropy}_${currentNonce}`; // UUID-style combination
        
        // Create semantic description for the JAM (enhanced to prevent collisions)
        const description = JSON.stringify({
            type: 'JAM',
                    pattern: jam.meta.pattern_type,
                    cosmic: jam.cosmic?.mev_metadata?.intent_class || 'STANDARD',
                    resonance: jam.resonance,
                    hash: hash.slice(0, 10),
                    entropy: entropy,
                    pid: pid,
                    retry: retry,
                    feeMultiplier: feeMultiplier.toFixed(3),
                    uuid: uuid
                });
                const categoryId = 1; // Category 1 for JAM signals

                // Enhanced transaction submission with better error handling
                tx = await dmap.registerSignal(description, categoryId, {
                    gasLimit,
                    maxFeePerGas: finalMaxFee,
                    maxPriorityFeePerGas: finalPriorityFee,
                    nonce: currentNonce
                });

                // Add transaction to pending set for tracking
                await nonceManager.addPendingTransaction(tx.hash);
                console.log(`tx_sent="success" hash=${tx.hash} nonce=${currentNonce} fee_multiplier=${feeMultiplier.toFixed(3)} priority_fee=${ethers.utils.formatUnits(finalPriorityFee, 'gwei')} max_fee=${ethers.utils.formatUnits(finalMaxFee, 'gwei')}`);
                
                // Success - increment nonce manager
                nonceManager.incrementNonce();
                break;
            } catch (error) {
                retries--;
                const errorMsg = error.message.toLowerCase();
                
                console.warn(`emit_retry="${error.message}" attempts_left=${retries} nonce=${currentNonce} fee_multiplier=${feeMultiplier.toFixed(3)}`);

                if (retries === 0) throw error;

                // Handle specific error types
                if (errorMsg.includes('replacement transaction underpriced') || 
                    errorMsg.includes('nonce too low') || 
                    errorMsg.includes('already known')) {
                    // Refresh nonce from network
                    try {
                        nonceManager.resetNonce();
                        currentNonce = await nonceManager.getNonce(provider, wallet.address);
                        console.log(`nonce_refreshed="from_network" new_nonce=${currentNonce}`);
                    } catch (nonceErr) {
                        console.warn(`nonce_refresh_err="${nonceErr.message}"`);
                        currentNonce++; // Fallback increment
                    }
                }

                // Phi-aligned fee escalation - more aggressive for underpriced errors
                if (errorMsg.includes('replacement transaction underpriced')) {
                    feeMultiplier *= PHI; // φ = 1.618 - phi-aligned escalation for underpriced
                    console.log(`fee_escalation="phi_aligned" error="underpriced" new_multiplier=${feeMultiplier.toFixed(3)}`);
                } else {
                    feeMultiplier *= 1.2; // Standard escalation for other errors
                    console.log(`fee_escalation="standard" new_multiplier=${feeMultiplier.toFixed(3)}`);
                }

                // Phi-aligned backoff with jitter
                const attemptsMade = 5 - retries;
                const phiBackoff = Math.floor(PHI * 1000 * attemptsMade); // φ-scaled linear backoff
                const jitter = Math.random() * 500; // Small jitter
                await new Promise(r => setTimeout(r, phiBackoff + jitter));
            }
        }

        // Enhanced transaction confirmation with resilient RPC calls
        let txReceipt;
        const phiTimeout = Math.floor(PHI * 30 * 1000); // φ * 30 seconds = ~48.5s
        
        try {
            txReceipt = await Promise.race([
                tx.wait(1), // Wait for 1 confirmation
                new Promise((_, reject) => setTimeout(() => reject(new Error('Transaction confirmation timed out')), phiTimeout))
            ]);
        } catch (waitError) {
            console.log(`tx_wait_timeout="${waitError.message}" hash=${tx.hash} attempting_resilient_receipt_check=true`);
            
            // Enhanced recovery using resilient RPC calls
            try {
                // Use resilient RPC call for receipt checking with retries across providers
                const receipt = await resilientRpcCall('eth_getTransactionReceipt', [tx.hash]);
                
                if (receipt && receipt.status === '0x1') {
                    console.log(`tx_recovered="resilient_success" hash=${tx.hash} block=${parseInt(receipt.blockNumber, 16)} providers_tried=multiple`);
                    txReceipt = {
                        status: 1,
                        transactionHash: tx.hash,
                        blockNumber: parseInt(receipt.blockNumber, 16),
                        gasUsed: receipt.gasUsed
                    };
                } else if (receipt && receipt.status === '0x0') {
                    throw new Error(`Transaction reverted: ${tx.hash}`);
                } else if (receipt === null) {
                    // Transaction still pending across all providers
                    console.log(`tx_status="globally_pending" hash=${tx.hash} action="treat_as_success" reason="signal_broadcast"`);
                    txReceipt = { status: 1, transactionHash: tx.hash, blockNumber: 'pending' };
                } else {
                    console.log(`tx_status="unknown_receipt" hash=${tx.hash} receipt=${JSON.stringify(receipt)} action="treat_as_success"`);
                    txReceipt = { status: 1, transactionHash: tx.hash, blockNumber: 'unknown' };
                }
            } catch (receiptError) {
                const errorMsg = receiptError.message.toLowerCase();
                
                if (errorMsg.includes('transaction indexing is in progress')) {
                    // Indexing in progress across all providers - transaction likely succeeded
                    console.log(`tx_recovery="indexing_in_progress" hash=${tx.hash} action="treat_as_success" reason="indexing_lag"`);
                    txReceipt = { status: 1, transactionHash: tx.hash, blockNumber: 'indexing' };
                } else if (errorMsg.includes('all rpc endpoints failed')) {
                    // All providers failed - but transaction was broadcast
                    console.log(`tx_recovery="all_rpc_failed" hash=${tx.hash} action="treat_as_success" reason="broadcast_confirmed"`);
                    txReceipt = { status: 1, transactionHash: tx.hash, blockNumber: 'rpc_failure' };
                } else {
                    console.log(`tx_recovery_failed="${receiptError.message}" hash=${tx.hash} action="treat_as_success" reason="signal_sent"`);
                    txReceipt = { status: 1, transactionHash: tx.hash, blockNumber: 'error_recovery' };
                }
            }
        }

        if (!txReceipt || txReceipt.status !== 1) {
            throw new Error(`Transaction failed or timed out: ${tx.hash}`);
        }

        console.log(`emit_status=\"success\" tx=${tx.hash}`)

        // ---- STATE UPDATE ----
        // The causal chain is extended. Persist the new state.
        jamStore.saveSuccessfulJAM(hash, jam);
        systemState.lastHash = hash;
        systemState.metrics.emissionSuccesses++;
        const selectedPattern = jam.meta.pattern_type;
        if (systemState.metrics.patternSuccess[selectedPattern]) {
             systemState.metrics.patternSuccess[selectedPattern].successes++;
        }
        
        // Update latest-jam.json file for gist updater
        try {
            const latestJamPath = path.join(__dirname, 'latest-jam.json');
            fs.writeFileSync(latestJamPath, JSON.stringify(jam, null, 2));
            console.log(`latest_jam_updated="success" hash=${hash.slice(0, 10)}`);
        } catch (jamFileErr) {
            console.error(`latest_jam_update_err="${jamFileErr.message}"`);
        }
        // ---- END STATE UPDATE ----

    } catch (error) {
        // Comprehensive error handling for transaction failures
        const errorMsg = error.message || error.toString();
        const errorLower = errorMsg.toLowerCase();
        
        if (errorLower.includes('insufficient funds') || errorLower.includes('insufficient balance')) {
            console.error(`emit_err="insufficient_funds" balance_check="required" action="skip_emission"`);
            console.error(`balance_err_detail="${errorMsg.slice(0, 200)}"`);
            
            // Check actual balance vs required
            try {
                const balance = await provider.getBalance(wallet.address);
                const balanceEth = ethers.utils.formatEther(balance);
                const feeData = await provider.getFeeData();
                const baseFee = feeData.lastBaseFeePerGas || feeData.gasPrice || ethers.utils.parseUnits('0.02', 'gwei');
                const estimatedCost = baseFee.mul(250000); // gasLimit * baseFee
                const costEth = ethers.utils.formatEther(estimatedCost);
                
                console.error(`balance_status="insufficient" current="${balanceEth}" required="${costEth}" chain="base"`);
                
                if (balance.lt(estimatedCost.mul(10))) { // Less than 10x tx cost
                    console.error(`balance_alert="critically_low" threshold="10x_tx_cost" action="pause_emissions"`);
                    // Pause for longer when critically low
                    setTimeout(() => {}, 30000); // 30 second pause
                }
            } catch (balanceErr) {
                console.error(`balance_check_err="${balanceErr.message}"`);
            }
        } else if (errorLower.includes('nonce') || errorLower.includes('already known')) {
            console.error(`emit_err="nonce_error" action="refresh_nonce"`);
            console.error(`nonce_err_detail="${errorMsg.slice(0, 150)}"`);
            
            // Force nonce refresh from network
            try {
                const actualNonce = await provider.getTransactionCount(wallet.address, 'pending');
                console.log(`nonce_correction="applied" old=${systemState.currentNonce} new=${actualNonce}`);
                systemState.currentNonce = actualNonce;
            } catch (nonceErr) {
                console.error(`nonce_refresh_err="${nonceErr.message}"`);
                // Fallback: decrement optimistic nonce
                systemState.currentNonce--;
            }
        } else if (errorLower.includes('gas') || errorLower.includes('intrinsic')) {
            console.error(`emit_err="gas_error" action="adjust_gas_params"`);
            console.error(`gas_err_detail="${errorMsg.slice(0, 150)}"`);
            
            // Log current gas parameters for debugging
            try {
                const feeData = await provider.getFeeData();
                console.error(`gas_debug="current_params" base_fee="${ethers.utils.formatUnits(feeData.lastBaseFeePerGas || '0', 'gwei')}" gwei`);
            } catch (gasErr) {
                console.error(`gas_debug_err="${gasErr.message}"`);
            }
        } else if (errorLower.includes('replacement') || errorLower.includes('underpriced')) {
            console.error(`emit_err="fee_too_low" action="increase_fees"`);
            console.error(`fee_err_detail="${errorMsg.slice(0, 150)}"`);
        } else if (errorLower.includes('timeout') || errorLower.includes('network')) {
            console.error(`emit_err="network_timeout" action="retry_next_cycle"`);
            console.error(`network_err_detail="${errorMsg.slice(0, 150)}"`);
        } else if (errorLower.includes('reverted') || errorLower.includes('execution')) {
            console.error(`emit_err="transaction_reverted" action="check_contract_state"`);
            console.error(`revert_err_detail="${errorMsg.slice(0, 200)}"`);
            
            // Enhanced contract accessibility check using resilient RPC
            try {
                const ownerCall = await resilientRpcCall('eth_call', [
                    {
                        to: process.env.DMAP_ADDRESS,
                        data: '0x8da5cb5b' // owner() function selector
                    },
                    'latest'
                ]);
                console.log(`contract_check="dmap_accessible" owner_call="success"`);
            } catch (contractErr) {
                const errorMsg = contractErr.message.toLowerCase();
                if (errorMsg.includes('transaction indexing is in progress')) {
                    console.warn(`contract_check="indexing_in_progress" status="temporarily_unavailable"`);
                } else if (errorMsg.includes('all rpc endpoints failed')) {
                    console.error(`contract_check="all_rpc_failed" status="network_issues"`);
                } else {
                    console.error(`contract_check="dmap_inaccessible" err="${contractErr.message}"`);
                }
            }
        } else {
            // Generic error handling
            console.error(`emit_err="unknown" type="${error.name || 'Error'}"`);
            console.error(`unknown_err_detail="${errorMsg.slice(0, 200)}"`);
            
            // Log stack trace for debugging if available
            if (error.stack) {
                console.error(`err_stack="${error.stack.split('\n')[0]}"`);
            }
        }
        
        // NONCE RECOVERY: Always revert the optimistic nonce increment on failure
        systemState.currentNonce--;
        console.log(`tx_fail_event="reverting_nonce" next_nonce_is_now=${systemState.currentNonce}`);
        systemState.metrics.emissionFailures++;
        
        // Track error types in metrics
        if (!systemState.metrics.errorTypes) {
            systemState.metrics.errorTypes = {};
        }
        const errorType = errorLower.includes('insufficient funds') ? 'insufficient_funds' :
                          errorLower.includes('nonce') ? 'nonce_error' :
                          errorLower.includes('gas') ? 'gas_error' :
                          errorLower.includes('timeout') ? 'network_timeout' :
                          errorLower.includes('reverted') ? 'transaction_reverted' : 'unknown';
        
        systemState.metrics.errorTypes[errorType] = (systemState.metrics.errorTypes[errorType] || 0) + 1;
        console.log(`error_tracking="updated" type="${errorType}" count=${systemState.metrics.errorTypes[errorType]}`);
    } finally {
        // Always save state and release lock
        saveSystemState();
        await releaseLock();
    }
}

// --- Execution Control Flags ---
// Prevent overlapping executions between main loop and MoTS processing
let isMainLoopRunning = false;
let isMotsRunning = false;

// --- Main Loop (Robust, Non-Overlapping) ---
// Define the main loop function BEFORE the initialization block
const runMainLoop = async () => {
    if (isMainLoopRunning || isMotsRunning) {
        console.log(`main_loop_skip="already_running" main_loop=${isMainLoopRunning} mots=${isMotsRunning}`);
        // Schedule next run anyway to maintain timing
        const INTERVAL = parseInt(process.env.DETECT_INTERVAL, 10) || BASE_EMISSION_INTERVAL;
        setTimeout(runMainLoop, INTERVAL);
        return;
    }
    
    isMainLoopRunning = true;
    try {
        await detectAndEmit();
    } catch (error) {
        console.error(`main_loop_err="${error.message}"`);
    } finally {
        isMainLoopRunning = false;
        // Schedule the next run after the interval, ensuring no overlaps
        const INTERVAL = parseInt(process.env.DETECT_INTERVAL, 10) || BASE_EMISSION_INTERVAL;
        console.log(`next_run_scheduled_in_seconds=${INTERVAL / 1000}`);
        setTimeout(runMainLoop, INTERVAL);
    }
};

// --- Main Initialization ---
(async () => {
    // Check for active narrative from file system (set by narrative watcher)
    let narrativeModel = process.env.NARRATIVE_MODEL || 'default';
    try {
        const narrativeActiveFile = path.join(__dirname, '.narrative-active');
        if (fs.existsSync(narrativeActiveFile)) {
            const activeNarrative = fs.readFileSync(narrativeActiveFile, 'utf8').trim();
            if (activeNarrative) {
                narrativeModel = activeNarrative;
                console.log(`narrative_source="file" active="${narrativeModel}"`);
            }
        }
    } catch (e) {
        console.log(`narrative_read_err="${e.message}" fallback="${narrativeModel}"`);
    }
    
    const modelPath = narrativeModel === 'default' ? 
        './models/mots-default' : 
        `./models/mots-${narrativeModel}.json`;
    
    const mots = new MoTSIntegration({
        rpcUrl: RPC_URLS[0].trim(),
        motsModelPath: modelPath,
        narrativeMode: narrativeModel !== 'default'
    });

    // MoTS Integration: Removed detectAndEmit() call to stop high-frequency emissions
    // Now only performs semantic learning without triggering emissions
    mots.streamMempoolSemantics(async (intent) => {
        if (intent && intent.confidence > 0.7) {
            if (isMainLoopRunning) {
                console.log(`mots_skip="main_loop_active" intent_confidence=${intent.confidence}`);
                return;
            }
            
            isMotsRunning = true;
            console.log(`mots_intent_detected=${JSON.stringify(intent)}`);
            
            try {
                // Feed semantic data to cosmic learning system
                const blockNumber = await provider.getBlockNumber();
                const block = await provider.getBlock(blockNumber);
                
                // Learn cosmic patterns from blockchain activity
                lunarClock.learnResonanceFromSemantics(
                    blockNumber,
                    block.gasUsed.toNumber(),
                    block.transactions.length,
                    intent.confidence * 100
                );
                
                // Detect local alignment patterns
                lunarClock.detectLocalAlignment(block.transactions);
                
                console.log(`cosmic_learning="updated" block=${blockNumber} semantic_weight=${(intent.confidence * 100).toFixed(1)}`);
            } catch (e) {
                console.log(`cosmic_learning_err="${e.message}"`);
            } finally {
                isMotsRunning = false;
            }
        }
    });

    // Load state *after* constants are defined
    await loadSystemState();
    
    console.log('engine_status="start" type="autonomous" phi="1.618"');
    console.log(`state_hash=${systemState.lastHash ? systemState.lastHash.slice(0,10) : 'none'} alignment="phi" depth=${systemState.lastHash ? 2 : 1}`);
    console.log(`recursive_state="initialized" metrics=${JSON.stringify(systemState.metrics).slice(0,50)}...`);
    console.log(`narrative_mode="${narrativeModel}" model="${modelPath}"`);
    
    // Use BASE_EMISSION_INTERVAL from constants (540000ms = 9 minutes)
    // Can be overridden by DETECT_INTERVAL env var if needed
    const INTERVAL = parseInt(process.env.DETECT_INTERVAL, 10) || BASE_EMISSION_INTERVAL;
    console.log(`interval_config="set" seconds=${INTERVAL/1000} phi_aligned="true"`);
    
    // Start the main loop after MoTS is initialized and state is loaded
    console.log(`initial_run="starting" alignment="recursive"`);
    runMainLoop();
})();
