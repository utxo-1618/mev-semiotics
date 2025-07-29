const { ethers } = require("ethers");
const { PROVERB_PATTERNS, RPC_URLS, PHI } = require('./constants');
const { DEX_CONFIGS, TOKENS } = require('./dex-config');

// Resilient RPC with failover
let currentRpcIndex = 0;

async function resilientRpcCall(method, params = [], maxRetries = RPC_URLS.length) {
    let lastError;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const rpcUrl = RPC_URLS[currentRpcIndex];
            const tempProvider = new ethers.providers.JsonRpcProvider(rpcUrl);
            
            // Set a phi-aligned timeout (30 seconds)
            const timeout = Math.floor(PHI * 20 * 1000); // ~32 seconds
            
            const result = await Promise.race([
                tempProvider.send(method, params),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Oracle RPC timeout')), timeout)
                )
            ]);
            
            return { provider: tempProvider, result };
        } catch (error) {
            lastError = error;
            console.warn(`oracle_rpc_attempt="failed" url="${RPC_URLS[currentRpcIndex]}" attempt=${attempt + 1}`);
            
            // Rotate to next RPC URL
            currentRpcIndex = (currentRpcIndex + 1) % RPC_URLS.length;
        }
    }
    
    throw new Error(`Oracle RPC failed: ${lastError.message}`);
}

// --- ABIs ---
const pairABI = [
    'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
    'function token0() external view returns (address)',
    'function token1() external view returns (address)'
];

// --- Cache ---
const cache = new Map();
const CACHE_TTL = 30 * 1000; // 30 seconds for live market data

/**
 * Fetches real-time reserves for a given token pair from a specific DEX.
 * This is the foundational function for all tactical analysis.
 * @param {string} fromTokenSymbol - e.g., 'WETH'
 * @param {string} toTokenSymbol - e.g., 'USDC'
 * @param {object} dex - A DEX object from dex-config.js
 * @param {ethers.Provider} provider - The JSON RPC provider.
 * @returns {Promise<object|null>} Reserves data or null on failure.
 */
async function getPairReserves(fromTokenSymbol, toTokenSymbol, dex, provider) {
    const fromAddress = TOKENS[fromTokenSymbol];
    const toAddress = TOKENS[toTokenSymbol];
    if (!fromAddress || !toAddress) return null;

    const cacheKey = `reserves:${dex.NAME}:${fromTokenSymbol}:${toTokenSymbol}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey);

    try {
        const factory = new ethers.Contract(dex.factory || dex.FACTORY, ['function getPair(address, address) external view returns (address)'], provider);
        const pairAddress = await factory.getPair(fromAddress, toAddress);

        if (pairAddress === ethers.constants.AddressZero) return null;

        const pairContract = new ethers.Contract(pairAddress, pairABI, provider);
        const [reserve0, reserve1] = await pairContract.getReserves();
        const token0 = await pairContract.token0();

        const result = token0.toLowerCase() === fromAddress.toLowerCase() ? { reserveA: reserve0, reserveB: reserve1 } : { reserveA: reserve1, reserveB: reserve0 };
        cache.set(cacheKey, result);
        setTimeout(() => cache.delete(cacheKey), CACHE_TTL);
        return result;

    } catch (e) {
        // console.error(`Failed to get reserves for ${fromTokenSymbol}/${toTokenSymbol} on ${dex.NAME}: ${e.message}`);
        return null;
    }
}

/**
 * Fetches and aggregates market data across the entire DEX cascade.
 * This is the main sensory input for the Tactical Brain.
 * @param {ethers.Provider} provider - The JSON RPC provider (optional, uses resilient RPC internally).
 * @returns {Promise<object>} A snapshot of current market conditions.
 */
async function getMarketData(provider) {
    const overallCacheKey = 'marketData';
    if (cache.has(overallCacheKey) && (Date.now() - cache.get(overallCacheKey).timestamp) < CACHE_TTL) {
        return cache.get(overallCacheKey).data;
    }

    console.log('oracle_fetch="start" msg="recalculating live market state"');

    try {
        // Use resilient RPC for fee data with recursive phi-aligned fallbacks
        let gasPrice = 1; // Default fallback
        try {
            const { provider: resilientProvider, result: feeData } = await resilientRpcCall('eth_feeHistory', [1, 'latest', []]);
            if (feeData && feeData.baseFeePerGas && feeData.baseFeePerGas[0]) {
                gasPrice = parseFloat(ethers.utils.formatUnits(feeData.baseFeePerGas[0], 'gwei'));
            } else {
                // Fallback to direct provider call if fee history format is unexpected
                const directFeeData = await resilientProvider.getFeeData();
                gasPrice = parseFloat(ethers.utils.formatUnits(directFeeData.gasPrice || '1', 'gwei'));
            }
            // Update provider reference for subsequent calls
            provider = resilientProvider;
        } catch (feeError) {
            console.warn(`oracle_fee_fallback="activated" msg="${feeError.message}"`);
            // Use original provider as final fallback
            if (provider) {
                try {
                    const fallbackFeeData = await provider.getFeeData();
                    gasPrice = parseFloat(ethers.utils.formatUnits(fallbackFeeData.gasPrice || '1', 'gwei'));
                } catch (finalError) {
                    console.warn(`oracle_fee_final_fallback="using_default" msg="${finalError.message}"`);
                }
            }
        }

        const marketData = {
            volatility: {},
            liquidity: {},
            gasPrice,
        };

        const analysisPromises = Object.keys(PROVERB_PATTERNS).map(async (patternName) => {
            const pattern = PROVERB_PATTERNS[patternName];
            const { from, to } = pattern.steps[0];
            const pair = `${from}/${to}`;

            let weakestLiquidity = Infinity;
            let highestVolatility = 0;

            // Use all available DEXs for market scanning
            const dexCascade = Object.values(DEX_CONFIGS);
            
            for (const dex of dexCascade) {
                const reserves = await getPairReserves(from, to, dex, provider);
                if (reserves) {
                    // --- Liquidity as a measure of pool depth (smaller reserve is weaker) ---
                    const currentLiquidity = Math.min(parseFloat(ethers.utils.formatUnits(reserves.reserveA, 18)), parseFloat(ethers.utils.formatUnits(reserves.reserveB, 6)));
                    if (currentLiquidity < weakestLiquidity) {
                        weakestLiquidity = currentLiquidity;
                    }

                    // --- Volatility as a proxy of reserve imbalance ---
                    const ratio = reserves.reserveA.isZero() ? 0 : parseFloat(reserves.reserveB.toString()) / parseFloat(reserves.reserveA.toString());
                    // A simple heuristic: large deviation from a 'normal' ratio implies recent volatility.
                    // This should be replaced with historical time-series analysis for true volatility.
                    const currentVolatility = Math.abs(1 - ratio / (pattern.baseResonance || 1)); // Compare to a baseline
                    if(currentVolatility > highestVolatility) {
                        highestVolatility = currentVolatility;
                    }
                }
            }
            
            marketData.liquidity[pair] = weakestLiquidity === Infinity ? 0 : weakestLiquidity;
            marketData.volatility[pair] = highestVolatility;
        });

        await Promise.all(analysisPromises);

        console.log('oracle_fetch="success"', JSON.stringify(marketData));
        cache.set(overallCacheKey, { timestamp: Date.now(), data: marketData });
        return marketData;

    } catch (error) {
        console.error(`oracle_fetch="error" msg="${error.message}"`);
        return null; // Gracefully fail, engine will use defaults
    }
}

module.exports = { getMarketData };

