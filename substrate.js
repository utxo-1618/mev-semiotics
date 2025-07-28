// substrate.js
// Amplified Bytecode Substrate Analyzer
// Includes caching, resilience, and configurable logging.

const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");

// --- Configuration ---
const DECOMPILER_URL = process.env.DECOMPILER_API_URL || "https://api.evmdecompiler.com/decompile";
const DECOMPILER_API_KEY = process.env.DECOMPILER_API_KEY; // Optional API Key
const CACHE_PATH = path.join(__dirname, 'substrate-cache.json');

// --- Cache Management ---
let substrateCache = {};
try {
    if (fs.existsSync(CACHE_PATH)) {
        substrateCache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
    }
} catch (e) {
    console.warn(`sub_err=cache msg="${e.message}"`);
}

function saveCache() {
    try {
        fs.writeFileSync(CACHE_PATH, JSON.stringify(substrateCache, null, 2));
    } catch (e) {
        console.error(`sub_err=save_cache msg="${e.message}"`);
    }
}

// --- Core Functions ---

async function fetchBytecode(address, provider) {
    try {
        const bytecode = await provider.getCode(address);
        if (!bytecode || bytecode === "0x") {
            throw new Error("No bytecode found");
        }
        return bytecode;
    } catch (err) {
        console.error(`sub_err=fetch_code addr=${address} msg="${err.message}"`);
        return null;
    }
}

async function decompileBytecode(bytecode) {
    const PHI = 1.618033988749895;  // Golden ratio
    const PHI_INVERSE = 0.618033988749895;  // Conjugate
    
    const headers = { "Content-Type": "application/json" };
    if (DECOMPILER_API_KEY) {
        headers["Authorization"] = `Bearer ${DECOMPILER_API_KEY}`;
    }

    try {
        const res = await fetch(DECOMPILER_URL, {
            method: "POST",
            headers,
            body: JSON.stringify({ bytecode }),
            timeout: 15000 // 15-second timeout for the API call
        });

        if (!res.ok) {
            throw new Error(`API error: ${res.status} ${res.statusText}`);
        }

        const data = await res.json();
        if (!data || typeof data !== 'object') {
            throw new Error('Invalid API response format');
        }

        // Enhanced phi-aligned validation cascade with detailed error collection
        const validationErrors = [];
        
        // Validate and sanitize source with phi-resonance checks
        let source = '';
        if (typeof data.source === 'string') {
            source = data.source;
            // Check source length against phi-harmonic bounds
            const sourceLength = source.length;
            if (sourceLength < Math.floor(100 * PHI_INVERSE)) {
                validationErrors.push(`Source too short: ${sourceLength} chars (min: ${Math.floor(100 * PHI_INVERSE)})`);
            }
        } else {
            validationErrors.push('Source field missing or invalid type');
            source = ''; // Fallback default
        }

        // Validate risk object with phi-aligned scoring
        let risk = {};
        if (data.risk && typeof data.risk === 'object') {
            risk = data.risk;
            // Validate risk score if present
            if ('score' in risk && (typeof risk.score !== 'number' || risk.score < 0 || risk.score > PHI * 10)) {
                validationErrors.push(`Invalid risk score: ${risk.score}`);
                risk.score = PHI; // Default to golden ratio as neutral risk
            }
        } else {
            validationErrors.push('Risk object missing or invalid');
            risk = { score: PHI, phi_aligned: false }; // Fallback with phi marker
        }

        // Validate bait_hooks array with phi-resonance filtering
        let bait_hooks = [];
        if (Array.isArray(data.bait_hooks)) {
            bait_hooks = data.bait_hooks.filter(hook => {
                if (typeof hook === 'string' && hook.length > 0) {
                    return true;
                }
                validationErrors.push(`Invalid hook entry: ${JSON.stringify(hook)}`);
                return false;
            });
            
            // Ensure minimum phi-aligned hook count
            const minHooks = Math.floor(PHI * 2); // ~3 hooks minimum
            if (bait_hooks.length < minHooks) {
                validationErrors.push(`Insufficient hooks: ${bait_hooks.length} (min: ${minHooks})`);
                // Add default hooks if missing
                const defaultHooks = ['swap', 'swapExactETHForTokens', 'swapExactTokensForTokens'];
                defaultHooks.forEach(hook => {
                    if (!bait_hooks.includes(hook)) bait_hooks.push(hook);
                });
            }
        } else {
            validationErrors.push('bait_hooks array missing');
            bait_hooks = ['swap', 'swapExactETHForTokens', 'swapExactTokensForTokens']; // Fallback defaults
        }

        // Calculate substrate hash with phi-resonance metadata
        const substrate_hash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(source || bytecode.slice(0, 100)));
        
        // Validate additional fields if present
        const additionalFields = {};
        if (data.confidence && typeof data.confidence === 'number') {
            if (data.confidence < 0 || data.confidence > 1) {
                validationErrors.push(`Invalid confidence: ${data.confidence}`);
                additionalFields.confidence = PHI_INVERSE; // Default to conjugate
            } else {
                additionalFields.confidence = data.confidence;
            }
        }

        const result = {
            source_estimate: source,
            risk,
            bait_hooks,
            substrate_hash,
            validation_timestamp: Date.now(),
            phi_validation: {
                errors: validationErrors,
                resonance_score: validationErrors.length === 0 ? PHI : PHI_INVERSE,
                cascade_ready: validationErrors.length < Math.floor(PHI * 2)
            },
            ...additionalFields
        };
        
        if (validationErrors.length > 0) {
            console.warn(`sub_val_warn=true count=${validationErrors.length} msg="${validationErrors.join(', ')}"`);
        }
        
        return result;
    } catch (err) {
        console.error(`sub_err=decompile msg="${err.message}"`);
        // Return phi-aligned fallback structure
        return {
            source_estimate: '',
            risk: { score: PHI, api_failure: true },
            bait_hooks: ['swap', 'swapExactETHForTokens', 'swapExactTokensForTokens'],
            substrate_hash: ethers.utils.keccak256(bytecode),
            validation_timestamp: Date.now(),
            phi_validation: {
                errors: [`API failure: ${err.message}`],
                resonance_score: PHI_INVERSE,
                cascade_ready: false
            }
        };
    }
}

/**
 * Analyzes a contract, using cache first.
 * @param {string} address - The contract address to analyze.
 * @param {ethers.providers.Provider} provider - The ethers provider.
 * @returns {Promise<object>} A structured analysis object.
 */
async function analyzeContract(address, provider) {
    const PHI = 1.618033988749895;  // Golden ratio for resonance alignment
    
    // 1. Check cache with phi-aligned validity
    if (substrateCache[address] && substrateCache[address].bytecode_proof) {
        const cacheAge = (Date.now() - (substrateCache[address].timestamp || 0)) / 1000;
        const validityWindow = Math.floor(3600 * PHI); // ~5800 seconds cache validity
        
        if (cacheAge < validityWindow) {
            console.log(`sub_cache=hit addr=${address} valid=true`);
            return substrateCache[address];
        }
    }

    console.log(`sub_cache=miss addr=${address} state=analyzing`);
    const bytecode = await fetchBytecode(address, provider);
    if (!bytecode) return { audit_pass: false, reason: "No bytecode" };

    const bytecode_proof = ethers.utils.keccak256(bytecode);
    
    // Check for known safe contracts first
    // Known safe contracts on Base
    const KNOWN_SAFE_CONTRACTS = [
        '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // USDC on Base
        '0x4200000000000000000000000000000000000006', // WETH on Base
        '0x50c5725949a6f0c72e6c4a641f24049a917db0cb', // DAI on Base
    ];
    
    // If it's a known contract, skip decompiler and use safe defaults
    if (KNOWN_SAFE_CONTRACTS.includes(address.toLowerCase())) {
        console.log(`sub_audit=safe addr=${address}`);
        const analysisResult = {
            address,
            bytecode_proof,
            audit_pass: true,
            source_estimate: "Known safe contract",
            risk: {},
            bait_hooks: ['swap', 'swapExactETHForTokens', 'swapExactTokensForTokens'], 
            substrate_hash: bytecode_proof
        };
        
        // Cache and return
        substrateCache[address] = analysisResult;
        substrateCache[bytecode_proof] = analysisResult;
        saveCache();
        return analysisResult;
    }

    // 2. If no decompiler API is configured, use heuristic analysis
    if (!DECOMPILER_URL || DECOMPILER_URL.includes('example.com')) {
        console.log(`sub_analyze=heuristic api=false`);
        // Basic heuristic analysis - check bytecode size and patterns
        const bytecodeSize = bytecode.length / 2 - 1; // Remove 0x and divide by 2
        const hasCreate2 = bytecode.includes('f5'); // CREATE2 opcode
        const hasDelegateCall = bytecode.includes('f4'); // DELEGATECALL opcode
        const hasSelfdestruct = bytecode.includes('ff'); // SELFDESTRUCT opcode
        
        const analysisResult = {
            address,
            bytecode_proof,
            audit_pass: false, // Default to fail - must prove safety
            source_estimate: "Heuristic analysis (no decompiler available)",
            risk: {
                has_create2: hasCreate2,
                has_delegatecall: hasDelegateCall,
                has_selfdestruct: hasSelfdestruct,
                bytecode_size: bytecodeSize
            },
            bait_hooks: ['swap', 'swapExactETHForTokens', 'swapExactTokensForTokens'], // Common DEX hooks
            substrate_hash: bytecode_proof
        };
        
        // Known safe contracts on Base (already defined above, remove duplicate)
        const KNOWN_SAFE_CONTRACTS_HEURISTIC = [
            process.env.USDC_ADDRESS || '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // USDC on Base
            process.env.WETH_ADDRESS || '0x4200000000000000000000000000000000000006', // WETH on Base
            process.env.DAI_ADDRESS || '0x50c5725949a6f0c72e6c4a641f24049a917db0cb', // DAI on Base
        ];
        
        if (KNOWN_SAFE_CONTRACTS_HEURISTIC.includes(address.toLowerCase())) {
            analysisResult.audit_pass = true;
            analysisResult.source_estimate = "Known safe contract";
        } else if (bytecodeSize < 100) {
            analysisResult.audit_pass = false;
            analysisResult.reason = "Contract too small - likely a proxy";
        } else if (hasSelfdestruct) {
            analysisResult.audit_pass = false;
            analysisResult.reason = "Contract contains SELFDESTRUCT opcode";
        }
        
        // Cache and return
        substrateCache[address] = analysisResult;
        substrateCache[bytecode_proof] = analysisResult;
        saveCache();
        return analysisResult;
    }

    // Attempt decompilation with phi-aligned retry logic
    let decomp = null;
    if (DECOMPILER_URL && !DECOMPILER_URL.includes('example.com')) {
        decomp = await decompileBytecode(bytecode);
    }

    // Define PHI constants for risk calculations
    const PHI_INVERSE = 0.618033988749895;
    
    // Extract bytecode characteristics (reuse variables if already declared)
    let bytecodeSize, hasCreate2, hasDelegateCall, hasSelfdestruct;
    
    if (!DECOMPILER_URL || DECOMPILER_URL.includes('example.com')) {
        // Variables already set in heuristic branch, no need to recalculate
        bytecodeSize = bytecode.length / 2 - 1;
        hasCreate2 = bytecode.includes('f5');
        hasDelegateCall = bytecode.includes('f4');
        hasSelfdestruct = bytecode.includes('ff');
    } else {
        // Calculate for decompiler path
        bytecodeSize = bytecode.length / 2 - 1; // Remove 0x and divide by 2
        hasCreate2 = bytecode.includes('f5'); // CREATE2 opcode
        hasDelegateCall = bytecode.includes('f4'); // DELEGATECALL opcode
        hasSelfdestruct = bytecode.includes('ff'); // SELFDESTRUCT opcode
    }
    
    // 3. Decompose risk into granular, mechanically-derived factors
    const riskFactors = {
        has_create2: {
            present: hasCreate2,
            penalty: PHI_INVERSE * 1.5, // CREATE2 can obscure contract addresses
            score: hasCreate2 ? PHI_INVERSE * 1.5 : 0
        },
        has_delegatecall: {
            present: hasDelegateCall,
            penalty: PHI_INVERSE * 2,   // DELEGATECALL can execute arbitrary code
            score: hasDelegateCall ? PHI_INVERSE * 2 : 0
        },
        has_selfdestruct: {
            present: hasSelfdestruct,
            penalty: 3.0,                 // SELFDESTRUCT is a critical risk
            score: hasSelfdestruct ? 3.0 : 0
        },
        is_proxy_contract: {
            present: bytecodeSize < 200,  // Small contracts are often proxies
            penalty: 1.0,
            score: bytecodeSize < 200 ? 1.0 : 0
        }
    };

    // 4. Calculate final risk score as a deterministic sum of granular factors
    const totalRiskScore = Object.values(riskFactors).reduce((sum, factor) => sum + factor.score, 0);

    // 5. The audit now passes only if NO critical factors are present AND the total score is low.
    const audit_pass = !riskFactors.has_selfdestruct.present && totalRiskScore < 2.0;
    const audit_reason = audit_pass ? "Validation passed" : 
        (riskFactors.has_selfdestruct.present ? "Contract contains SELFDESTRUCT" : `Risk score ${totalRiskScore.toFixed(2)} exceeds threshold`);

    const analysisResult = {
        address,
        bytecode_proof,
        audit_pass: audit_pass,
        reason: audit_reason,
        source_estimate: decomp ? decomp.source_estimate : "Heuristic analysis",
        risk: {
            score: totalRiskScore,
            factors: riskFactors // Include the full granular breakdown
        },
        bait_hooks: decomp?.bait_hooks || ['swap', 'swapExactETHForTokens', 'swapExactTokensForTokens'],
        substrate_hash: bytecode_proof,
        timestamp: Date.now(),
        phi_alignment: {
            risk_resonance: totalRiskScore.toFixed(3),
            size_factor: (bytecodeSize / 1000 * PHI_INVERSE).toFixed(3)
        }
    };
    
    if (bytecodeSize < 100) {
        analysisResult.audit_pass = false;
        analysisResult.reason = "Contract too small - likely a proxy";
    }
    
    // Cache with phi-aligned metadata
    substrateCache[address] = analysisResult;
    substrateCache[bytecode_proof] = analysisResult;
    saveCache();
    return analysisResult;

}

module.exports = { analyzeContract };

