const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Ensure log directories exist
const logDirs = [
  './logs/cache',
  './logs/utils'
];

logDirs.forEach(dir => {
  const fullPath = path.join(__dirname, dir);
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true });
  } else {
    // Clear existing log files
    const files = fs.readdirSync(fullPath);
    files.forEach(file => {
      if (file.endsWith('.log')) {
        fs.writeFileSync(path.join(fullPath, file), '');
      }
    });
  }
});

// Clear system state lock on startup
const systemStatePath = path.join(__dirname, 'system-state.json');
if (fs.existsSync(systemStatePath)) {
  try {
    const systemState = JSON.parse(fs.readFileSync(systemStatePath, 'utf8'));
    // Clear any locks
    if (systemState.isEmittingLock) {
      systemState.isEmittingLock.isLocked = false;
      systemState.isEmittingLock.pid = null;
      systemState.isEmittingLock.timestamp = null;
    }
    fs.writeFileSync(systemStatePath, JSON.stringify(systemState, null, 2));
    console.log('system_state="cleared_locks"');
  } catch (e) {
    console.warn(`system_state_clear_error="${e.message}"`);
  }
} else {
  // Create initial system state if it doesn't exist
  const initialState = {
    "lastHash": null,
    "metrics": {
      "totalAnalyses": 0,
      "auditPasses": 0,
      "auditFails": 0,
      "emissionSuccesses": 0,
      "emissionFailures": 0,
      "lastAuditFailReason": null,
      "patternSuccess": {},
      "errorTypes": {}
    },
    "isEmittingLock": {
      "isLocked": false,
      "pid": null,
      "timestamp": null
    },
    "currentNonce": 0
  };
  fs.writeFileSync(systemStatePath, JSON.stringify(initialState, null, 2));
  console.log('system_state="initialized"');
}

module.exports = {
  apps: [
    {
      name: 'engine',
      script: './index.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_restarts: 5,
      min_uptime: '300s',
      max_memory_restart: '300M',
      error_file: './logs/cache/engine.log',
      out_file: './logs/cache/engine.log',
      merge_logs: true,
      env: {
        NODE_ENV: 'production',
        RPC_URL: process.env.RPC_URL,
        PRIVATE_KEY: process.env.PRIVATE_KEY,
        VAULT_ADDRESS: process.env.VAULT_ADDRESS || '0x38bA461686B65C10C1eeffbc4009C7C5Dc27EC26',
        DMAP_ADDRESS: process.env.DMAP_ADDRESS || '0xb2Ea27Fa784e25C8c03c1E4f2E11300973a8e919',
        ERROR_LOGGING: process.env.ERROR_LOGGING || 'minimal',
        SUPPRESS_DISABLED_FEATURES: 'true',
// --- Oracle Config ---
        // Required for substrate analysis
        TARGET_CONTRACT_ADDRESS: process.env.TARGET_CONTRACT_ADDRESS,
        // Optional decompiler settings - will use local analysis if not provided
        DECOMPILER_API_URL: process.env.DECOMPILER_API_URL || 'https://api.evmdecompiler.com/decompile',
        DECOMPILER_API_KEY: process.env.DECOMPILER_API_KEY || '',
        // --- System Config ---
        DETECT_INTERVAL: process.env.DETECT_INTERVAL || 540000, // 9 minutes for PHI-aligned recursion
        MAX_GAS_GWEI: process.env.MAX_GAS_GWEI || 0.01618,
        // --- Cross-Chain Config ---
        ENABLE_BSV_ECHO: process.env.ENABLE_BSV_ECHO || 'true',
        BSV_PRIVATE_KEY: process.env.BSV_PRIVATE_KEY,
        // --- Narrative Config ---
        NARRATIVE_MODEL: process.env.NARRATIVE_MODEL || 'default',
        ENABLE_MOTS: process.env.ENABLE_MOTS || 'true',
        // --- Cosmic Timing Config ---
        // BIRTH_TIMESTAMP: process.env.BIRTH_TIMESTAMP || '', // Optional: Unix timestamp for natal chart
        // WALLET_ADDRESS: process.env.WALLET_ADDRESS, // Used for personal cosmic signature
      }
    },
    {
      name: 'amplifier',
      script: './semantic-amplifier.js',
      cwd: __dirname,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '60s',
      error_file: './logs/cache/amplifier.log',
      out_file: './logs/cache/amplifier.log',
      merge_logs: true,
      env: {
        NODE_ENV: 'production',
        RPC_URL: process.env.RPC_URL,
        PRIVATE_KEY: process.env.PRIVATE_KEY,
        MIRROR_PRIVATE_KEY: process.env.MIRROR_PRIVATE_KEY,
        ERROR_LOGGING: process.env.ERROR_LOGGING || 'minimal',
        SUPPRESS_DISABLED_FEATURES: 'true',
        WALLET_ADDRESS: process.env.WALLET_ADDRESS, // Required for listener
        VAULT_ADDRESS: process.env.VAULT_ADDRESS || '0x38bA461686B65C10C1eeffbc4009C7C5Dc27EC26',
        DMAP_ADDRESS: process.env.DMAP_ADDRESS,
      }
    },
    {
      name: 'mirror',
      script: './mirror.js',
      cwd: __dirname,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '60s',
      error_file: './logs/cache/mirror.log',
      out_file: './logs/cache/mirror.log',
      merge_logs: true,
      env: {
        NODE_ENV: 'production',
        RPC_URL: process.env.RPC_URL,
        PRIVATE_KEY: process.env.PRIVATE_KEY, // For reading wallet address
        MIRROR_PRIVATE_KEY: process.env.MIRROR_PRIVATE_KEY,
        WALLET_ADDRESS: process.env.WALLET_ADDRESS, // Required for listener
        VAULT_ADDRESS: process.env.VAULT_ADDRESS || '0x38bA461686B65C10C1eeffbc4009C7C5Dc27EC26',
      }
    },
    {
      name: 'mon',
      script: './monitor.js',
      cwd: __dirname,
      autorestart: true,
      watch: ['./latest-jam.json'],
      max_restarts: 10,
      min_uptime: '60s',
      error_file: './logs/cache/mon.log',
      out_file: './logs/cache/mon.log',
      merge_logs: true,
      env: {
        NODE_ENV: 'production',
        RPC_URL: process.env.RPC_URL,
        VAULT_ADDRESS: process.env.VAULT_ADDRESS || '0x38bA461686B65C10C1eeffbc4009C7C5Dc27EC26',
      }
    },
    {
      name: 'gistupd',
      script: './update-gist.js',
      cwd: __dirname,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '60s',
      error_file: './logs/cache/gistupd.log',
      out_file: './logs/cache/gistupd.log',
      merge_logs: true,
      env: {
        NODE_ENV: 'production',
        GIST_ID: process.env.GIST_ID,
        GITHUB_TOKEN: process.env.GITHUB_TOKEN
      }
    },
    {
      name: 'narrative',
      script: './narrative-watcher.js',
      cwd: __dirname,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '60s',
      error_file: './logs/cache/narrative.log',
      out_file: './logs/cache/narrative.log',
      merge_logs: true,
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'attribution',
      script: './attribution-monitor.js',
      cwd: __dirname,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '60s',
      error_file: './logs/cache/attribution.log',
      out_file: './logs/cache/attribution.log',
      merge_logs: true,
      env: {
        NODE_ENV: 'production',
        RPC_URL: process.env.RPC_URL,
        PRIVATE_KEY: process.env.PRIVATE_KEY,
        VAULT_ADDRESS: process.env.VAULT_ADDRESS || '0x38bA461686B65C10C1eeffbc4009C7C5Dc27EC26',
        DMAP_ADDRESS: process.env.DMAP_ADDRESS || '0xb2Ea27Fa784e25C8c03c1E4f2E11300973a8e919',
        ERROR_LOGGING: process.env.ERROR_LOGGING || 'minimal'
      }
    },
    {
      name: 'feed-api',
      script: './feed-api.js',
      cwd: __dirname,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '60s',
      error_file: './logs/cache/feed-api.log',
      out_file: './logs/cache/feed-api.log',
      merge_logs: true,
      env: {
        NODE_ENV: 'production',
        FEED_PORT: process.env.FEED_PORT || 8585
      }
    }
  ]
};
