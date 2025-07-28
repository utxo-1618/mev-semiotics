// Golden ratio constants for DEX cascading and priority calculations
const PHI = 1.618033988749895;          // φ (Golden ratio)
const PHI_INVERSE = 0.618033988749895;   // 1/φ
const PHI_SQUARED = 2.618033988749895;    // φ²
const PHI_CUBED = 4.236067977499790;      // φ³

/**
 * Router ABI for concentrated liquidity V3 pools - Used for precise swap execution
 * through Uniswap V3-style pools with concentrated liquidity positions.
 * @type {Array<Object>}
 */
const routerAbiV3 = [
  {
    "inputs": [
      {"internalType":"address","name":"tokenIn","type":"address"},
      {"internalType":"address","name":"tokenOut","type":"address"},
      {"internalType":"uint24","name":"fee","type":"uint24"},
      {"internalType":"address","name":"recipient","type":"address"},
      {"internalType":"uint256","name":"deadline","type":"uint256"},
      {"internalType":"uint256","name":"amountIn","type":"uint256"},
      {"internalType":"uint256","name":"amountOutMinimum","type":"uint256"},
      {"internalType":"uint160","name":"sqrtPriceLimitX96","type":"uint160"}
    ],
    "name": "exactInputSingle",
    "outputs": [
      {"internalType": "uint256", "name": "", "type": "uint256"}
    ],
    "stateMutability": "payable",
    "type": "function"
  }
];

// DEX Configuration for Base Network
// Ordered by volume and liquidity depth

const DEX_CONFIGS = {
  // Aerodrome - Maintained as last-resort fallback DEX only
  // Priority: 0.382 (lowest) - Used only when primary DEXes fail
  AERODROME: {
    ROUTER: '0xcf77a3ba9a5ca399b7c97c74d54e5b1beb874e43',
    factory: '0x420dd381b31aef6683db6b902084cb0ffece40da',
    NAME: 'Aerodrome',
    TYPE: 'solidly-fork',
    POOLS: {
      'WETH-USDC': '0xcdac0d6c6c59727a65f871236188350531885c43'
    }
  },


  // Uniswap V3 - High volume, concentrated liquidity
  UNISWAP_V3: {
    ROUTER: '0x2626664c2603336e57b271c5c0b26f421741e481',
    SWAP_ROUTER: '0x2626664c2603336e57b271c5c0b26f421741e481',
    quoter: '0x3d4e44eb1374240ce5f1b871ab261cd16335b76a',
    NAME: 'Uniswap V3',
    TYPE: 'concentrated-liquidity',
    FEE_TIERS: {
      'WETH-USDC': 500,  // 0.05%
      'WETH-DAI': 500,   // 0.05%
      'default': 3000    // 0.3%
    },
    GAS_MULTIPLIER: 1.1  // 10% buffer for gas estimation
  },

  // SushiSwap V3 on Base
  SUSHISWAP_V3: {
    ROUTER: '0xfb7ef66a7e61224dd6fcd0d7d9c3be5c8b049b9f',
    NAME: 'SushiSwap V3',
    TYPE: 'uniswap-v2-fork'
  },

  // RocketSwap - Growing volume
  ROCKETSWAP: {
    ROUTER: '0x4CF22670302b0b678B65403D8408436aBDe59aBB',
    NAME: 'RocketSwap',
    TYPE: 'uniswap-v2-fork'
  },

  // Alien Base - New but gaining traction
  ALIEN_BASE: {
    ROUTER: '0x8C1E4a23be7030E29e064b031b5056f3Fd76389d',
    NAME: 'Alien Base',
    TYPE: 'uniswap-v2-fork'
  }
};

// Token addresses on Base - Minimal 4-token set for concentrated liquidity
const TOKENS = {
  WETH: '0x4200000000000000000000000000000000000006',
  USDC: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
  DAI: '0x50c5725949a6f0c72e6c4a641f24049a917db0cb',
  COMP: '0x9e1028f5f1d5ede59748ffcee5532509976840e0', // Compound governance token
};

// Liquidity pools by DEX (for reference)
const LIQUIDITY_POOLS = {
  AERODROME: {
    'WETH-USDC': {
      pool: '0xcdac0d6c6c59727a65f871236188350531885c43',
      fee: 100, // 0.01%
      volume24h: '$50M+',
      tvl: '$100M+'
    }
  },
  UNISWAP_V3: {
    'WETH-USDC': {
      pool: '0xd0b53d9277642d899df5c87a3966a349a798f224',
      fee: 500, // 0.05%
      volume24h: '$30M+',
      tvl: '$60M+'
    }
  }
};

/**
 * Helper to pick best DEX based on current gas price and trade size
 * @param {number} gasPrice - Current gas price in Gwei
 * @param {number} tradeSize - Trade size in ETH
 * @returns {{primary: Object, fallback: Object, reason: string}} Selected DEX configuration with fallback
 */
function selectOptimalDEX(gasPrice, tradeSize) {
  // Validate inputs
  if (!gasPrice || gasPrice <= 0) {
    console.warn('Invalid gas price provided to selectOptimalDEX');
    return {
      primary: DEX_CONFIGS.UNISWAP_V3,
      fallback: DEX_CONFIGS.ROCKETSWAP,
      reason: 'Default due to invalid gas price'
    };
  }
  
  if (!tradeSize || tradeSize <= 0) {
    console.warn('Invalid trade size provided to selectOptimalDEX');
    return {
      primary: DEX_CONFIGS.UNISWAP_V3,
      fallback: DEX_CONFIGS.ROCKETSWAP,
      reason: 'Default due to invalid trade size'
    };
  }
  const gasPriceGwei = parseFloat(gasPrice);
  const tradeSizeETH = parseFloat(tradeSize);

  // For tiny trades (< 0.0001 ETH), use Uniswap V3
  if (tradeSizeETH < 0.0001) {
    return {
      primary: DEX_CONFIGS.UNISWAP_V3,
      fallback: DEX_CONFIGS.ROCKETSWAP,
      reason: 'Small trade - using Uniswap V3 for reliability'
    };
  }

  // For medium trades during low gas, Uniswap is still good
  if (gasPriceGwei < 10 && tradeSizeETH < 0.01) {
    return {
      primary: DEX_CONFIGS.UNISWAP_V3,
      fallback: DEX_CONFIGS.ROCKETSWAP,
      reason: 'Medium trade, low gas - concentrated liquidity optimal'
    };
  }

  // Default to Uniswap V3 for all trades
  return {
    primary: DEX_CONFIGS.UNISWAP_V3,
    fallback: DEX_CONFIGS.ROCKETSWAP,
    reason: 'Default - using Uniswap V3 for best execution'
  };
}

/**
 * Aerodrome-specific pool helper to find pool address for token pair
 * @param {string} tokenA - First token address
 * @param {string} tokenB - Second token address
 * @param {boolean} [stable=false] - Whether to use stable or volatile pool
 * @returns {string|null} Pool address if found, null otherwise
 */
function getAerodromePool(tokenA, tokenB, stable = false) {
  // Aerodrome uses deterministic pool addresses based on token pair and stability
  const key = `${tokenA}-${tokenB}`;
  const reverseKey = `${tokenB}-${tokenA}`;
  
  if (DEX_CONFIGS.AERODROME.POOLS[key]) {
    return DEX_CONFIGS.AERODROME.POOLS[key];
  } else if (DEX_CONFIGS.AERODROME.POOLS[reverseKey]) {
    return DEX_CONFIGS.AERODROME.POOLS[reverseKey];
  }
  
  // Return null if pool not found - caller should query factory
  return null;
}

// Route hints for 4-token strategy paths through specific DEXes
const ROUTE_HINTS = {
  // Optimized paths for minimal token set
  AERODROME: {
    'ETH->USDC': ['WETH', 'USDC'],
    'ETH->DAI': ['WETH', 'USDC', 'DAI'], // Through USDC for better liquidity
    'USDC->DAI': ['USDC', 'DAI'],
    'USDC->COMP': ['USDC', 'COMP']
  }
};

/**
 * Recursive DEX cascade selector with phi-harmonic alignment
 * Selects optimal DEX sequence based on gas price and trade size using golden ratio scaling
 * @param {number} gasPrice - Current gas price in Gwei
 * @param {number} tradeSize - Trade size in ETH
 * @param {number} [depth=1] - Recursion depth for cascade calculation
 * @returns {Array<Object>} Ordered array of DEX configurations by priority
 */
// Mechanically determined DEX priorities based on perceived reliability and liquidity
const DEX_PRIORITIES = {
  UNISWAP_V3: PHI_SQUARED,      // 2.618 - Highest priority for deep liquidity
  ROCKETSWAP: PHI,              // 1.618 - Reliable backup
  SUSHISWAP_V3: PHI,              // 1.618 - Alternative V3
  ALIEN_BASE: PHI_INVERSE,      // 0.618 - Lower priority
  AERODROME: 1,                 // 1.000 - Stable fallback
};

/**
 * Generates a deterministic DEX cascade based on the mechanical state of a JAM.
 * @param {object} jamData - The full JAM object containing the system's recursive state.
 * @returns {Array<Object>} Ordered array of DEX configurations.
 */
function getRecursiveDEXCascade(jamData) {
  // 1. Extract deterministic factors from the JAM's recursive state
  const resonance = parseFloat(jamData.resonance) || 1.0;
  const depth = jamData.cascadeDepth || 1;
  const topology = jamData.recursiveTopology || { eth: 1, bsv: 0 };
  const phiRelations = (jamData.meta && jamData.meta.phiRelations) ? jamData.meta.phiRelations : [1.618, 0.618, 1];

  // 2. Mechanically translate topology into a confidence weight.
  // Higher BSV echo count increases confidence in the signal's value.
  const bsvConfidence = (topology.bsv || 0) > 0 ? (1 + (topology.bsv / topology.eth) * PHI) : 1;

  // 3. Define the available DEXes to be included in the cascade calculation
  const availableDEXes = ['UNISWAP_V3', 'ROCKETSWAP', 'SUSHISWAP_V3', 'AERODROME', 'ALIEN_BASE'];

  // 4. Mechanically calculate weighted priorities for each DEX
  const weightedCascade = availableDEXes.map((dexName, index) => {
    const basePriority = DEX_PRIORITIES[dexName] || 1;
    // Use the JAM's phiRelations as a deterministic rotational multiplier
    const relationMultiplier = parseFloat(phiRelations[index % phiRelations.length]) || 1;

    // The deterministic translation formula:
    // Priority = (Base * Resonance * Confidence * RotationalMultiplier) / Depth
    const finalPriority = (basePriority * resonance * bsvConfidence * relationMultiplier) / depth;
    
    return {
      dex: DEX_CONFIGS[dexName],
      priority: finalPriority,
    };
  });

  // 5. Sort the cascade based on the final, mechanically-determined priority
  return weightedCascade
    .sort((a, b) => b.priority - a.priority)
    .map(item => item.dex);
}

module.exports = {
  DEX_CONFIGS,
  TOKENS,
  LIQUIDITY_POOLS,
  selectOptimalDEX,
  getAerodromePool,
  ROUTE_HINTS,
  getRecursiveDEXCascade,
  routerAbiV3,  // Export ABI for external use
  // Export phi constants for external calculations
  PHI,
  PHI_INVERSE,
  PHI_SQUARED,
  PHI_CUBED
};
