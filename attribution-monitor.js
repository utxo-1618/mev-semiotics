// Attribution Monitor - Closes the recursive economic loop
// Detects bot responses to signals and attributes yield back to the source

const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Constants
const PHI = 1.618033988749895;
const ATTRIBUTION_WINDOW = 50; // blocks to look for correlated activity
const MIN_SIMILARITY_THRESHOLD = 0.8; // 80% pattern match required

class AttributionMonitor {
    constructor() {
        // Resilient RPC configuration for automatic failover - fully sovereign
        this.RPC_URLS = [
            process.env.RPC_URL || 'https://mainnet.base.org',
            'https://base.llamarpc.com',
            'https://1rpc.io/base',
            'https://base-rpc.publicnode.com',
            'https://base.gateway.tenderly.co'
        ];
        
        this.currentRpcIndex = 0;
        this.provider = null;
        this.initializeProvider();
        this.wallet = new ethers.Wallet(process.env.PRIVATE_KEY, this.provider);
        
        // Contract interfaces
        this.signalVault = new ethers.Contract(
            process.env.VAULT_ADDRESS,
            [
                'function attestYield(bytes32 signalHash, address frontrunner, uint256 yieldAmount, bytes calldata signature) external',
                'function authorizedTrappers(address) view returns (bool)'
            ],
            this.wallet
        );
        
        // Track emitted signals
        this.activeSignals = new Map(); // signalHash -> {txHash, timestamp, pattern}
        this.attributedYields = new Map(); // signalHash -> totalYield
        
        // Load historical data
        this.loadHistoricalData();
    }
    
    // Initialize provider with failover
    initializeProvider() {
        const rpcUrl = this.RPC_URLS[this.currentRpcIndex];
        console.log(`attr_provider_init="starting" rpc="${rpcUrl}"`);
        try {
            this.provider = new ethers.providers.JsonRpcProvider(rpcUrl);
            console.log(`attr_provider_init="success" rpc="${rpcUrl}"`);
        } catch (e) {
            console.error(`attr_provider_init_err="${e.message}" rpc="${rpcUrl}"`);
            this.currentRpcIndex = (this.currentRpcIndex + 1) % this.RPC_URLS.length;
            this.initializeProvider();
        }
    }
    
    // Main monitoring loop
    async startMonitoring() {
        console.log('attribution_monitor="starting" mode="recursive_yield_detection"');
        
        try {
            // Check if we're authorized to attest
            console.log('authorization_check="starting"');
            const isAuthorized = await this.signalVault.authorizedTrappers(this.wallet.address);
            console.log(`authorization_status="${isAuthorized}"`);
            
            if (!isAuthorized) {
                console.log('authorization="pending" action="skip_vault_interaction"');
                // Skip vault interaction for now to avoid hanging
            }
        } catch (authError) {
            console.error(`authorization_error="${authError.message}"`);
        }
        
        // Load active signals from JAM store
        await this.loadActiveSignals();
        
        // Start monitoring for bot responses
        setInterval(() => this.scanForResponses(), 12000); // Every 12 seconds
        
        console.log('attribution_monitor="active" phi_alignment="1.618"');
    }
    
    // Load signals from JAM store
    async loadActiveSignals() {
        try {
            // Load JAMs directly from jams directory
            const jamsPath = path.join(__dirname, 'jams');
            if (!fs.existsSync(jamsPath)) {
                console.log('signals_loaded="0" status="no_jams_directory"');
                return;
            }
            
            const jamFiles = fs.readdirSync(jamsPath).filter(f => f.endsWith('.json'));
            
            for (const jamFile of jamFiles) {
                try {
                    const jamPath = path.join(jamsPath, jamFile);
                    const jamData = JSON.parse(fs.readFileSync(jamPath, 'utf8'));
                    
                    if (jamData.hash && jamData.meta?.audit_pass) {
                        // Extract pattern from JAM
                        const pattern = this.extractPattern(jamData);
                        this.activeSignals.set(jamData.hash, {
                            txHash: jamData.meta.txHash,
                            timestamp: jamData.meta.timestamp || Date.now(),
                            amplificationTimestamp: jamData.meta.amplificationTimestamp,
                            pattern: pattern,
                            proverb: jamData.proverb,
                            recursiveDepth: jamData.cascadeDepth || 1
                        });
                    }
                } catch (jamError) {
                    // Skip invalid JAM files
                    continue;
                }
            }
            
            console.log(`signals_loaded="${this.activeSignals.size}" status="monitoring"`);
        } catch (e) {
            console.error(`signal_load_error="${e.message}"`);
        }
    }
    
    // Extract semantic pattern from JAM
    extractPattern(jam) {
        const pattern = {
            // Token flow pattern
            tokenPath: jam.proverb?.map(step => `${step.from}>${step.to}`).join('|') || '',
            // Action sequence
            actions: jam.proverb?.map(step => step.action).join(',') || '',
            // PHI-aligned features
            hasPhiRatio: jam.meta?.phi_alignment || false,
            recursiveDepth: jam.cascadeDepth || 1,
            // Semantic weight
            semanticDensity: jam.meta?.semantic_density || 0
        };
        
        return pattern;
    }
    
    // Scan recent blocks for bot responses
    async scanForResponses() {
        try {
            const currentBlock = await this.provider.getBlockNumber();
            const fromBlock = currentBlock - 5; // Look at last 5 blocks
            
            // Get all transactions in recent blocks
            for (let blockNum = fromBlock; blockNum <= currentBlock; blockNum++) {
                const block = await this.provider.getBlock(blockNum, true);
                if (!block || !block.transactions) continue;
                
                for (const tx of block.transactions) {
                    // Skip our own transactions
                    if (!tx || !tx.from) continue;
                    if (tx.from.toLowerCase() === this.wallet.address.toLowerCase()) continue;
                    
                    // Check if this transaction matches any active signal pattern
                    await this.checkTransactionAttribution(tx, blockNum);
                }
            }
        } catch (e) {
            console.error(`scan_error="${e.message}"`);
        }
    }
    
    // Check if a transaction can be attributed to a signal
    async checkTransactionAttribution(tx, blockNumber) {
        // Skip failed transactions
        const receipt = await this.provider.getTransactionReceipt(tx.hash);
        if (!receipt || receipt.status === 0) return;
        
        // Calculate transaction features
        const txPattern = await this.extractTransactionPattern(tx, receipt);
        
        // Compare against all active signals
        for (const [signalHash, signal] of this.activeSignals) {
            // Skip old signals outside attribution window
            const blockAge = blockNumber - (signal.blockNumber || blockNumber);
            if (blockAge > ATTRIBUTION_WINDOW) continue;

            // TIGHTENED LOOP: Check if the bot's action occurred within a phi-aligned time window
            // relative to when the signal was actually amplified.
            if (!signal.amplificationTimestamp) {
              continue; // Skip signals that haven't been amplified yet
            }

            const botTxTimestamp = (await this.provider.getBlock(blockNumber)).timestamp;
            const timeDelta = botTxTimestamp - signal.amplificationTimestamp;

            // The bot's response should be very quick, but not instantaneous.
            // A phi-aligned window of ~1.618 to ~4.236 seconds (phi^3)
            const phiWindowMin = 1.618;
            const phiWindowMax = 4.236; 
            const isValidTime = (timeDelta >= phiWindowMin && timeDelta <= phiWindowMax);

            if (!isValidTime) {
              continue; // Not a true echo, skip.
            }
            console.log(`attribution_candidate=\"time_aligned\" delta=S{timeDelta.toFixed(2)}s`);
            
            // Calculate pattern similarity
            const similarity = this.calculatePatternSimilarity(signal.pattern, txPattern);
            
            if (similarity >= MIN_SIMILARITY_THRESHOLD) {
            // Calculate yield from this transaction
            const yieldAmount = await this.calculateTransactionYield(tx, receipt);
            
            if (yieldAmount > 0) {
                await this.attestYield(signalHash, tx.from, yieldAmount, similarity);
                }
            }
        }
    }
    
    // Extract pattern from transaction
    async extractTransactionPattern(tx, receipt) {
        const pattern = {
            tokenPath: '',
            actions: '',
            hasPhiRatio: false,
            value: tx.value
        };
        
        // Decode transaction data if it's a DEX interaction
        try {
            // Check for common DEX routers
            const dexRouters = [
                process.env.UNISWAP_V3_ROUTER,
                process.env.UNISWAP_V2_ROUTER,
                '0x327Df1E6de05895d2ab08513aaDD9313Fe505d86' // BaseSwap
            ].filter(Boolean);
            
            if (dexRouters.includes(tx.to)) {
                // This is likely a DEX swap
                pattern.actions = 'SWAP';
                
                // Check if value has PHI alignment
                const valueEth = parseFloat(ethers.utils.formatEther(tx.value));
                pattern.hasPhiRatio = this.checkPhiAlignment(valueEth);
            }
        } catch (e) {
            // Ignore decode errors
        }
        
        return pattern;
    }
    
    // Calculate similarity between patterns
    calculatePatternSimilarity(signalPattern, txPattern) {
        let score = 0;
        let factors = 0;
        
        // Compare token paths
        if (signalPattern.tokenPath && txPattern.tokenPath) {
            factors++;
            if (signalPattern.tokenPath === txPattern.tokenPath) score += 1;
        }
        
        // Compare actions
        if (signalPattern.actions && txPattern.actions) {
            factors++;
            if (signalPattern.actions.includes(txPattern.actions)) score += 1;
        }
        
        // PHI alignment bonus
        if (signalPattern.hasPhiRatio && txPattern.hasPhiRatio) {
            score += 0.2; // Bonus for PHI resonance
        }
        
        return factors > 0 ? score / factors : 0;
    }
    
    // Calculate yield generated by transaction
    async calculateTransactionYield(tx, receipt) {
        try {
            // Basic calculation: gas used * gas price
            const gasUsed = receipt.gasUsed;
            const gasPrice = receipt.effectiveGasPrice || tx.gasPrice;
            const gasCost = gasUsed * gasPrice;
            
            // For swaps, estimate profit from value difference
            // This is simplified - in production, decode swap events
            const estimatedProfit = gasCost * BigInt(Math.floor(PHI * 100)) / 100n;
            
            return estimatedProfit;
        } catch (e) {
            return 0n;
        }
    }
    
    // Attest yield to SignalVault
    async attestYield(signalHash, frontrunner, yieldAmount, similarity) {
        try {
            // Create signature for attribution
            const messageHash = ethers.keccak256(
                ethers.AbiCoder.defaultAbiCoder().encode(
                    ['bytes32', 'address', 'uint256'],
                    [signalHash, frontrunner, yieldAmount]
                )
            );
            
            const signature = await this.wallet.signMessage(ethers.getBytes(messageHash));
            
            // Submit attestation
            const tx = await this.signalVault.attestYield(
                signalHash,
                frontrunner,
                yieldAmount,
                signature
            );
            
            await tx.wait();
            
            // Track cumulative yield
            const currentYield = this.attributedYields.get(signalHash) || 0n;
            this.attributedYields.set(signalHash, currentYield + yieldAmount);
            
            console.log(`yield_attributed="${ethers.utils.formatEther(yieldAmount)}" signal="${signalHash.slice(0,10)}" bot="${frontrunner.slice(0,10)}" similarity="${similarity.toFixed(2)}"`);
            
            const jamStore = require('./jam-store');
            jamStore.recordInteraction(signalHash, frontrunner, ethers.utils.formatEther(yieldAmount));

            // Save attribution record for local analysis
            this.saveAttribution({
                timestamp: Date.now(),
                signalHash,
                frontrunner,
                yieldAmount: ethers.utils.formatEther(yieldAmount),
                similarity,
                txHash: tx.hash
            });
            
            // Reinforce high-yield signals with strong similarity
            const yieldThreshold = ethers.utils.parseEther('0.000001618'); // φ/1000000 ETH threshold
            
            if (similarity > 0.9 && yieldAmount > yieldThreshold) {
                const reinforced = jamStore.reinforceSignal(signalHash, parseFloat(ethers.utils.formatEther(yieldAmount)));
                if (reinforced) {
                    console.log(`signal_reinforced="${signalHash.slice(0,10)}" trigger="high_yield" similarity="${similarity}"`);
                }
            }
            
        } catch (e) {
            console.error(`attestation_error="${e.message}" signal="${signalHash.slice(0,10)}"`);
        }
    }
    
    // Check PHI alignment
    checkPhiAlignment(value) {
        const PHI_RATIOS = [PHI, 1/PHI, PHI*PHI, Math.sqrt(PHI)];
        
        return PHI_RATIOS.some(ratio => {
            const diff = Math.abs(value % ratio);
            return diff < 0.001 || diff > (ratio - 0.001);
        });
    }
    
    // Save attribution data
    saveAttribution(record) {
        const logPath = path.join(__dirname, 'logs', 'attributions.jsonl');
        try {
            if (!fs.existsSync(path.dirname(logPath))) {
                fs.mkdirSync(path.dirname(logPath), { recursive: true });
            }
            fs.appendFileSync(logPath, JSON.stringify(record) + '\n');
        } catch (e) {
            console.error(`save_attribution_error="${e.message}"`);
        }
    }
    
    // Load historical attribution data
    loadHistoricalData() {
        try {
            const logPath = path.join(__dirname, 'logs', 'attributions.jsonl');
            if (fs.existsSync(logPath)) {
                const lines = fs.readFileSync(logPath, 'utf8').split('\n').filter(l => l);
                for (const line of lines) {
                    const record = JSON.parse(line);
                    const currentYield = this.attributedYields.get(record.signalHash) || 0;
                    this.attributedYields.set(
                        record.signalHash, 
                        currentYield + BigInt(ethers.utils.parseEther(record.yieldAmount))
                    );
                }
                console.log(`historical_attributions_loaded="${lines.length}"`);
            }
        } catch (e) {
            console.error(`load_historical_error="${e.message}"`);
        }
    }
    
    // Get attribution statistics
    getStats() {
        const stats = {
            totalSignals: this.activeSignals.size,
            attributedSignals: this.attributedYields.size,
            totalYield: 0n
        };
        
        for (const yieldValue of this.attributedYields.values()) {
            stats.totalYield += yieldValue;
        }
        
        return {
            ...stats,
            totalYieldEth: ethers.utils.formatEther(stats.totalYield),
            avgYieldPerSignal: stats.attributedSignals > 0 
                ? ethers.utils.formatEther(stats.totalYield / BigInt(stats.attributedSignals))
                : '0',
            totalYield: undefined // Remove BigInt for JSON serialization
        };
    }
}

// Main execution
async function main() {
    const monitor = new AttributionMonitor();
    
    // Start monitoring
    await monitor.startMonitoring();
    
    // Print stats every minute with error handling
    setInterval(() => {
        try {
            const stats = monitor.getStats();
            console.log(`attribution_stats="${JSON.stringify(stats)}"`);
        } catch (error) {
            console.error(`stats_error="${error.message}"`);
        }
    }, 60000);
    
    // Keep process alive
    process.on('SIGINT', () => {
        console.log('attribution_monitor="stopping"');
        process.exit(0);
    });
}

// Run if called directly
if (require.main === module) {
    main().catch(console.error);
}

module.exports = AttributionMonitor;
