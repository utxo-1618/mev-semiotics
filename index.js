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
            systemState.currentNonce = await provider.getTransactionCount(wallet.address, 'pending');
            console.log(`nonce_init="fetched" nonce=${systemState.currentNonce}`);
        } catch (e) {
            console.error(`nonce_init_err="${e.message}"`);
            process.exit(1); // Exit if we cannot get a nonce
        }
    }
    saveSystemState();
}


// --- JAM Store (No change, it's already stateless) ---
class JAMStore {
    constructor() {
        this.storePath = path.join(__dirname, 'jams');
        this.ensureDirectory();
    }

    ensureDirectory() {
        if (!fs.existsSync(this.storePath)) {
            fs.mkdirSync(this.storePath, { recursive: true });
        }
    }
    
    store(hash, jamData) {
        const finalPath = path.join(this.storePath, `${hash}.json`);
        fs.writeFileSync(finalPath, JSON.stringify(jamData, null, 2));
        console.log(`jam_store_op="write" hash=${hash.slice(0, 10)}`)
    }

    retrieve(hash) {
        const filePath = path.join(this.storePath, `${hash}.json`);
        if (fs.existsSync(filePath)) {
            const data = fs.readFileSync(filePath, 'utf8');
            return JSON.parse(data);
        }
        return null;
    }
}
const jamStore = new JAMStore();


// --- Config and Constants ---
// All constants are now imported from constants.js at the top of the file

// Initialize provider with primary RPC
console.log(`provider_init="starting" rpc="${RPC_URLS[0].trim()}"`);
const provider = new ethers.providers.JsonRpcProvider(RPC_URLS[0].trim());

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
    
    // Select pattern based on current conditions and past performance
    const selectedPattern = selectOptimalPattern(systemState.metrics.patternSuccess, marketData);
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
        ipfs: "QmNNVfVhm1BoYYFFWCx9pGsidv7zA5YwCdGYYazVnA9fCb",
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

// Helper function to select optimal pattern with multi-layered intelligence
function selectOptimalPattern(patternMetrics, marketData) {
    const patterns = Object.keys(PROVERB_PATTERNS);
    marketData = marketData || { volatility: {}, liquidity: {}, gasPrice: 1 }; // Default if oracle fails

    const scores = patterns.map(patternName => {
        const pattern = PROVERB_PATTERNS[patternName];
        const metrics = patternMetrics[patternName] || { attempts: 0, successes: 0, lastUsed: 0 };
        const pair = `${pattern.steps[0].from}/${pattern.steps[0].to}`;

        // --- Layer 1: Tactical Brain ---
        const volatilityScore = marketData.volatility[pair] || 0;
        const liquidityScore = marketData.liquidity[pair] > 0 ? (1 / Math.log(marketData.liquidity[pair])) : 0;
        const gasAdaptationScore = 1 / (marketData.gasPrice + 1); // Favour action in low-gas environments

        // --- Layer 2: Reflexive Brain (Learning) ---
        const successRate = metrics.attempts > 0 ? metrics.successes / metrics.attempts : 0.5; // Start with a neutral bias
        const recency = (Date.now() - metrics.lastUsed) / (1000 * 60); // in minutes
        const cooldownPenalty = Math.max(0, 1 - (recency / 10)); // Penalty if used in last 10 mins
        const explorationBonus = metrics.attempts < 10 ? EXPLORATION_BONUS : 0;
        
        // --- Final Score Calculation (Weighted) ---
        const weightedScore = 
            (0.4 * successRate) +         // Past performance is most important
            (0.3 * volatilityScore) +     // Volatility is a strong signal of opportunity
            (0.1 * liquidityScore) +      // Lower liquidity can be easier to move
            (0.1 * gasAdaptationScore) +  // Adapt to gas regimes
            (0.1 * explorationBonus) -    // Encourage trying new things
            cooldownPenalty;              // Avoid spamming the same pattern

        console.log(`pattern_score name=${patternName} score=${weightedScore.toFixed(3)} (success=${successRate.toFixed(2)}, vol=${volatilityScore.toFixed(2)}, liq=${liquidityScore.toFixed(2)})`);
        return { pattern: patternName, score: weightedScore };
    });
    
    scores.sort((a, b) => b.score - a.score);
    console.log(`selected_pattern name=${scores[0].pattern} score=${scores[0].score.toFixed(3)}`);
    return scores[0].pattern;
}

// Pre-check balance before attempting emission
async function checkSufficientBalance() {
    try {
        const balance = await provider.getBalance(wallet.address);
        const feeData = await provider.getFeeData();
        const baseFee = feeData.lastBaseFeePerGas || feeData.gasPrice || ethers.utils.parseUnits('0.02', 'gwei');
        const estimatedCost = baseFee.mul(250000); // gasLimit * baseFee
        const minimumRequired = estimatedCost.mul(3); // 3x safety margin
        
        const balanceEth = ethers.utils.formatEther(balance);
        const requiredEth = ethers.utils.formatEther(minimumRequired);
        
        if (balance.lt(minimumRequired)) {
            console.warn(`balance_precheck="insufficient" current="${balanceEth}" required="${requiredEth}" margin="3x"`);
            return false;
        }
        
        console.log(`balance_precheck="sufficient" current="${balanceEth}" required="${requiredEth}"`);
        return true;
    } catch (err) {
        console.error(`balance_precheck_err="${err.message}"`);
        return true; // Proceed if check fails
    }
}

async function detectAndEmit() {
    console.log(`detect_and_emit:start pid=${process.pid}`);
    
    const marketData = await getMarketData(provider);

    // Check cosmic timing window before proceeding
    const cosmicWindow = lunarClock.getEmissionWindow();
    
    if (!(await acquireLock())) {
        return;
    }
    
    try {
        console.log(`nonce_fetch="starting" wallet=${wallet.address}`);
        // Ensure nonce accuracy with timeout
        try {
            systemState.currentNonce = await Promise.race([
                provider.getTransactionCount(wallet.address, 'pending'),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Nonce fetch timeout')), 10000))
            ]);
        } catch (nonceError) {
            console.error(`nonce_fetch_err="${nonceError.message}"`);
            // Try without 'pending' parameter
            try {
                systemState.currentNonce = await Promise.race([
                    provider.getTransactionCount(wallet.address),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Nonce fetch timeout (retry)')), 10000))
                ]);
                console.log(`nonce_fetch="recovered" method="without_pending"`);
            } catch (retryError) {
                console.error(`nonce_fetch_retry_err="${retryError.message}"`);
                throw retryError;
            }
        }

        const nonce = systemState.currentNonce;
        console.log(`tx_nonce="using" nonce=${nonce}`);
        
        // Optimistically increment the nonce for the next run.
        systemState.currentNonce++;
        saveSystemState(); 
        console.log(`nonce_update="optimistic_increment" next_nonce=${systemState.currentNonce}`);

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

        // Set fixed gas limit for Base network
        const gasLimit = ethers.BigNumber.from('250000');

        // Get current fee data from Base network
        const feeData = await provider.getFeeData();
        const baseFee = feeData.lastBaseFeePerGas || feeData.gasPrice || ethers.utils.parseUnits('0.02', 'gwei');
        
        // Ultra-minimal, phi-aligned fees for Base L2.
        const maxPriorityFeePerGas = ethers.utils.parseUnits('0.001618', 'gwei'); // Minimal inclusion bribe
        const maxFeePerGas = baseFee.mul(110).div(100).add(maxPriorityFeePerGas); // 1.1x base fee + priority
        
        console.log(`gas_fees_optimized: maxFeePerGas=${ethers.utils.formatUnits(maxFeePerGas, 'gwei')} gwei, maxPriorityFeePerGas=${ethers.utils.formatUnits(maxPriorityFeePerGas, 'gwei')} gwei`);

        // Check balance before attempting transaction submission
        if (!(await checkSufficientBalance())) {
            console.log(`tx_skip="insufficient_balance" jam_generated="true" action="skip_onchain_only"`);
            // JAM was still generated and stored, just skipping on-chain emission
            systemState.currentNonce--; // Rollback optimistic nonce increment
            console.log(`nonce_rollback="balance_check" nonce=${systemState.currentNonce}`);
            return; // Return early, but JAM is still created
        }
        
        // Try emission with exponential backoff retry
        let tx;
        let retries = 3;
        while (retries > 0) {
            try {
                // Create semantic description for the JAM
                const description = JSON.stringify({
                    type: 'JAM',
                    pattern: jam.meta.pattern_type,
                    cosmic: jam.cosmic?.mev_metadata?.intent_class || 'STANDARD',
                    resonance: jam.resonance,
                    hash: hash.slice(0, 10)
                });
                const categoryId = 1; // Category 1 for JAM signals
                
                tx = await dmap.registerSignal(description, categoryId, {
                    gasLimit,
                    maxFeePerGas,
                    maxPriorityFeePerGas,
                    nonce: nonce
                });
                console.log(`tx_sent="success" hash=${tx.hash} nonce=${nonce}`);
                break;
            } catch (error) {
                retries--;
                if (retries === 0) throw error;
        console.warn(`emit_retry=\"${error.message}\" attempts_left=${retries}`);
        await loadSystemState(); // Refresh state to correct nonce
                await new Promise(r => setTimeout(r, (3-retries) * 1000)); // Exponential backoff
            }
        }

        const txReceipt = await Promise.race([
            tx.wait(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Transaction confirmation timed out')), 60000)) // 60s timeout
        ]);

        if (!txReceipt || txReceipt.status !== 1) {
            throw new Error(`Transaction failed or timed out: ${tx.hash}`);
        }

        console.log(`emit_status=\"success\" tx=${tx.hash}`)

        // ---- STATE UPDATE ----
        // The causal chain is extended. Persist the new state.
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
            
            // Check if DMAP contract is accessible
            try {
                const dmap = new ethers.Contract(process.env.DMAP_ADDRESS, [
                    "function owner() external view returns (address)"
                ], provider);
                await dmap.owner();
                console.log(`contract_check="dmap_accessible"`);
            } catch (contractErr) {
                console.error(`contract_check="dmap_inaccessible" err="${contractErr.message}"`);
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
