const { ethers } = require("ethers");

// --- Network and Contract Configuration ---
const RPC_URLS = (process.env.RPC_URLS || process.env.RPC_URL || 'https://mainnet.base.org').split(',').map(url => url.trim());
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const VAULT_ADDRESS = process.env.VAULT_ADDRESS;
const TARGET_CONTRACT_ADDRESS = process.env.TARGET_CONTRACT_ADDRESS;

// --- Phi-Harmonic Constants ---
const PHI = 1.618033988749895;
const PHI_INVERSE = 1 / PHI;
const PHI_SQUARED = PHI * PHI;
const PHI_CUBED = PHI * PHI * PHI;

// --- MEV Strategy Parameters (PHI-Aligned) ---
const EXPLORATION_BONUS = PHI_INVERSE; // ~0.618 - Golden ratio conjugate
const COOLDOWN_PENALTY = 1 - PHI_INVERSE; // ~0.382 - PHI complement

// --- Adaptive Pattern Library (4 Optimal Tokens) ---
const PROVERB_PATTERNS = {
    CLASSIC_ARBITRAGE: { name: 'Classic Arbitrage', steps: [ { from: 'WETH', to: 'USDC', action: 'SWAP', actor: 'AMPLIFIER' }, { from: 'USDC', to: 'WETH', action: 'SWAP', actor: 'MIRROR' } ], baseResonance: PHI },
    STABLE_ROTATION: { name: 'Stable Rotation', steps: [ { from: 'USDC', to: 'DAI', action: 'SWAP', actor: 'AMPLIFIER' }, { from: 'DAI', to: 'USDC', action: 'SWAP', actor: 'MIRROR' } ], baseResonance: PHI_INVERSE },
    ETH_DAI_FLOW: { name: 'ETH-DAI Flow', steps: [ { from: 'WETH', to: 'DAI', action: 'SWAP', actor: 'AMPLIFIER' }, { from: 'DAI', to: 'WETH', action: 'SWAP', actor: 'MIRROR' } ], baseResonance: PHI_SQUARED },
    DEFI_GOVERNANCE: { name: 'DeFi Governance', steps: [ { from: 'USDC', to: 'COMP', action: 'SWAP', actor: 'AMPLIFIER' }, { from: 'COMP', to: 'USDC', action: 'SWAP', actor: 'MIRROR' } ], baseResonance: PHI_CUBED }
};

// --- Emission Timing Configuration ---
const CONSENSUS_TIMES = [
  { hour: 13, minute: 21 },
  { hour: 21, minute: 1 },
  { hour: 3, minute: 33 },
  { hour: 8, minute: 1 },
  { hour: 20, minute: 8 }
];
const SUBINTERVALS = [3, 5, 8, 13];
const BASE_EMISSION_INTERVAL = 540000; // 9 minutes

module.exports = {
    RPC_URLS,
    PRIVATE_KEY,
    VAULT_ADDRESS,
    TARGET_CONTRACT_ADDRESS,
    EXPLORATION_BONUS,
    COOLDOWN_PENALTY,
    PHI,
    PHI_INVERSE,
    PHI_SQUARED,
    PHI_CUBED,
    PROVERB_PATTERNS,
    CONSENSUS_TIMES,
    SUBINTERVALS,
    BASE_EMISSION_INTERVAL
};
