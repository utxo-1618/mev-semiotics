
const { ethers } = require("ethers");
const { PROVERB_PATTERNS } = require('./constants');
const dexConfig = require('./dex-config');

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
    const fromAddress = dexConfig.getTokenAddress(fromTokenSymbol);
    const toAddress = dexConfig.getTokenAddress(toTokenSymbol);
    if (!fromAddress || !toAddress) return null;

    const cacheKey = `reserves:${dex.NAME}:${fromTokenSymbol}:${toTokenSymbol}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey);

    try {
        const factory = new ethers.Contract(dex.FACTORY, ['function getPair(address, address) external view returns (address)'], provider);
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
 * @param {ethers.Provider} provider - The JSON RPC provider.
 * @returns {Promise<object>} A snapshot of current market conditions.
 */
async function getMarketData(provider) {
    const overallCacheKey = 'marketData';
    if (cache.has(overallCacheKey) && (Date.now() - cache.get(overallCacheKey).timestamp) < CACHE_TTL) {
        return cache.get(overallCacheKey).data;
    }

    console.log('oracle_fetch="start" msg="recalculating live market state"');

    try {
        const feeData = await provider.getFeeData();
        const marketData = {
            volatility: {},
            liquidity: {},
            gasPrice: parseFloat(ethers.utils.formatUnits(feeData.gasPrice || '1', 'gwei')),
        };

        const analysisPromises = Object.keys(PROVERB_PATTERNS).map(async (patternName) => {
            const pattern = PROVERB_PATTERNS[patternName];
            const { from, to } = pattern.steps[0];
            const pair = `${from}/${to}`;

            let weakestLiquidity = Infinity;
            let highestVolatility = 0;

            for (const dex of dexConfig.DEX_CASCADE) {
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

