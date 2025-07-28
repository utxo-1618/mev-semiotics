const fs = require('fs');
const {join} = require('path');
const {ethers} = require('ethers');
const {CONSENSUS_TIMES:T, PHI} = require('./constants');
const lunarClock = require('./tools/lunar-clock');

// Ensure all required directories exist
const dirs = ['logs', 'data'];
dirs.forEach(dir => {
    const dirPath = join(__dirname, dir);
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
});

// Initialize provider with error handling
let provider;
try {
    // Use JsonRpcProvider for ethers v5 compatibility
    provider = new ethers.providers.JsonRpcProvider(
        process.env.RPC_URL || 'https://mainnet.base.org'
    );
    
    // Test provider connection
    provider.ready.then(() => {
        provider.getNetwork().then(network => {
            console.log(`Connected to network: ${network.name} (${network.chainId})`);
        });
    }).catch(e => {
        console.error(`Provider connection failed: ${e.message}`);
        process.exit(1);
    });
} catch (e) {
    console.error(`Provider initialization failed: ${e.message}`);
    process.exit(1);
}

// Initialize contract with validation
let v;
try {
    if (!process.env.VAULT_ADDRESS) {
        throw new Error('VAULT_ADDRESS not set');
    }
    v = new ethers.Contract(process.env.VAULT_ADDRESS, [
        "function getTotalHarvestedYield() view returns(uint256)",
        "function authorizedTrappers(address) view returns(bool)"
    ], provider);
} catch (e) {
    console.error(`Contract initialization failed: ${e.message}`);
    process.exit(1);
}

const F = {
    state: join(__dirname, 'system-state.json'),
    jam: join(__dirname, 'data', 'jam-store.json'),
    log: join(__dirname, 'logs', 'profit-monitor.log'),
    narrative: join(__dirname, 'narrative-state.json'),
    cosmic: join(__dirname, 'cosmic-state.json')
};

// Safe file reader with error handling
const r = path => {
    try {
        return fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, 'utf8')) : {};
    } catch (e) {
        console.error(`File read error (${path}): ${e.message}`);
        return {};
    }
};

const t = () => {
    const n = new Date();
    const m = n.getUTCHours() * 60 + n.getUTCMinutes();
    return T.reduce((a, t) => {
        const d = ((t.hour * 60 + t.minute) - m + 1440) % 1440;
        return d < a.d ? {w: `${t.hour}:${t.minute}`, d} : a;
    }, {w: '', d: Infinity});
};

const l = () => {
    try {
        const d = fs.existsSync(F.log) ? fs.readFileSync(F.log, 'utf8').trim().split('\n') : [];
        return d.reduce((a, l) => {
            try {
                const e = JSON.parse(l);
                return e.success ? {
                    p: (a.p + (parseFloat(e.profit) || 0)),
                    ok: a.ok + 1,
                    err: a.err
                } : {
                    p: a.p,
                    ok: a.ok,
                    err: a.err + 1
                };
            } catch (e) { return a; }
        }, {p: 0, ok: 0, err: 0});
    } catch (e) {
        console.error(`Log processing error: ${e.message}`);
        return {p: 0, ok: 0, err: 0};
    }
};

async function show() {
    try {
        console.clear();
        const [s, j] = [F.state, F.jam].map(r);
        const m = s.lastHash ? j[s.lastHash] : null;
        const {p, ok, err} = l();
        const {w, d} = t();
        
        const vaultAddress = process.env.VAULT_ADDRESS;
        let vb = '0', vy = '0';

        if (vaultAddress) {
            try {
                const balance = await provider.getBalance(vaultAddress);
                vb = ethers.utils.formatEther(balance || '0');
                
                const yield = await v.getTotalHarvestedYield();
                vy = ethers.utils.formatEther(yield || '0');
            } catch (e) {
                console.error(`Balance check error: ${e.message}`);
            }
        }
        
        const blockNumber = await provider.getBlockNumber();
        const cosmicWindow = lunarClock.getEmissionWindow();
        const cosmicResonance = lunarClock.calculateCosmicResonance();
        const narrative = r(F.narrative);
        
        // Compressed output
        console.log(`lunar=${cosmicWindow.phase}`);
        console.log(`state=${s.isEmittingLock?.isLocked?1:0} jam=${s.lastHash?.slice(2,10)||'null'} block=${blockNumber}`);
        console.log(`unison=${cosmicWindow.shouldEmit} epoch="${w}" dist=${d}min`);
        
    } catch (e) {
        console.error(`Show error: ${e.message}`);
    }
}

// Process error handlers
process.on('uncaughtException', (err) => {
    console.error(`Uncaught Exception: ${err.message}`);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// --- Main Loop ---
(async()=>{
    try {
        await show();
        setInterval(async () => {
            try {
                await show();
            } catch (e) {
                console.error(`Show loop error: ${e.message}`);
            }
        }, 10000);
    } catch (e) {
        console.error(`Main loop error: ${e.message}`);
        process.exit(1);
    }
})();
