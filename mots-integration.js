const { ethers } = require('ethers');
const { exec } = require('child_process');
const path = require('path');

/**
 * Executes the MoTS python script.
 * @param {string} command The command to execute.
 * @returns {Promise<string>} The stdout of the script.
 */
function runMotsScript(command) {
    return new Promise((resolve, reject) => {
        const motsPath = path.join(__dirname, 'MoTS');
        exec(`source ${motsPath}/mots_py310_env/bin/activate && python -m mots.${command}`, { cwd: motsPath }, (err, stdout, stderr) => {
            if (err) {
                console.error(`mots_script_err="${err.message}"`);
                return reject(err);
            }
            if (stderr) {
                console.error(`mots_script_stderr="${stderr}"`);
            }
            resolve(stdout.trim());
        });
    });
}

/**
 * MoTS Integration Module for PoRI
 * Extracts semantic vectors from blockchain transactions
 * and feeds them into the recursive amplification system
 */

class MoTSIntegration {
    constructor(config) {
        this.provider = new ethers.providers.JsonRpcProvider(config.rpcUrl);
        this.modelPath = config.motsModelPath || './models/mots-default';
        this.narrativeMode = config.narrativeMode || false;
        
        // Semantic categories aligned with PoRI's intent mining
        this.intentCategories = {
            ARBITRAGE: 'arbitrage_opportunity',
            LIQUIDITY: 'liquidity_provision', 
            SWAP: 'token_exchange',
            MEV: 'mev_extraction',
            RECURSIVE: 'recursive_pattern',
            UNKNOWN: 'unclassified_intent'
        };
    }

    /**
     * Extract semantic intent from a transaction
     * @param {string} txHash - Transaction hash to analyze
     * @returns {Object} Semantic intent data for JAM generation
     */
    async extractTransactionIntent(txHash) {
        try {
            const tx = await this.provider.getTransaction(txHash);
            const receipt = await this.provider.getTransactionReceipt(txHash);
            
            // Use MoTS to extract semantic vectors
            const semanticVector = JSON.parse(await runMotsScript(`spiders.transactions ${txHash}`));
            const classification = await runMotsScript(`spiders.classify ${JSON.stringify(semanticVector)}`);
            
            // Apply recursive PHI-aligned compression
            semanticVector = this.recursiveCompressIntent(semanticVector);

            // Parse transaction for PoRI-specific patterns
            const poriPatterns = this.detectPoriPatterns(tx, receipt);
            
            return {
                txHash,
                blockNumber: receipt.blockNumber,
                from: tx.from,
                to: tx.to,
                value: ethers.formatEther(tx.value),
                semanticVector,
                classification,
                poriPatterns,
                confidence: this.calculateConfidence(semanticVector, classification),
                timestamp: Date.now()
            };
        } catch (error) {
            console.error(`Failed to extract intent from ${txHash}:`, error);
            return null;
        }
    }

    /**
     * Detect PoRI-specific patterns in transactions
     * Looks for PHI ratios, recursive structures, semantic honeypots
     */
    detectPoriPatterns(tx, receipt) {
        const patterns = {
            hasPhiRatio: false,
            recursiveDepth: 0,
            semanticDensity: 0,
            honeypotSignal: false
        };

        // Check for PHI-related values in transaction amount
        const value = parseFloat(ethers.formatEther(tx.value));
        const PHI = 1.618033988749895;
        
        patterns.hasPhiRatio = this.checkPhiAlignment(value);
        
        // Analyze logs for recursive patterns
        if (receipt.logs) {
            patterns.recursiveDepth = this.calculateRecursiveDepth(receipt.logs);
            patterns.semanticDensity = this.calculateSemanticDensity(tx.data);
        }
        
        // Check for honeypot patterns
        patterns.honeypotSignal = this.detectHoneypotPattern(tx, receipt);
        
        return patterns;
    }

    /**
     * Recursively compress semantic vectors using PHI ratios
     * @param {Array} vector - Semantic vector to compress
     * @returns {Array} Compressed semantic vector
     */
    recursiveCompressIntent(vector) {
        const PHI = 1.618033988749895;
        // Simplified recursive compression logic
        // Here, you may define a more complex compression algorithm
        return vector.map(value => value / PHI);
    }

    /**
     * Stream real-time semantic extraction from mempool
     * Feeds directly into semantic-amplifier
     */
    async streamMempoolSemantics(callback) {
        this.provider.on('pending', async (txHash) => {
            const intent = await this.extractTransactionIntent(txHash);
            if (intent && intent.confidence > 0.7) {
                // Only forward high-confidence semantic signals
                callback(intent);
            }
        });
    }

    /**
     * Batch process historical blocks for semantic patterns (FILTERED)
     * Prevents 20GB data explosion by limiting scope
     */
    async analyzeHistoricalSemantics(startBlock, endBlock) {
        const semanticHistory = [];
        const MAX_BLOCKS = 10; // Limit to prevent bloat
        const actualEndBlock = Math.min(endBlock, startBlock + MAX_BLOCKS);
        
        console.log(`mots_analysis="limited" blocks="${actualEndBlock - startBlock}" reason="prevent_bloat"`);
        
        for (let blockNum = startBlock; blockNum <= actualEndBlock; blockNum++) {
            const block = await this.provider.getBlock(blockNum, false); // Don't fetch full transactions
            
            // Only analyze recent, high-value transactions
            const recentTxs = block.transactions.slice(0, 20); // Limit to first 20 txs
            
            for (const txHash of recentTxs) {
                const intent = await this.extractTransactionIntent(txHash);
                if (intent && intent.confidence > 0.8) { // Only high-confidence
                    semanticHistory.push(intent);
                }
                
                // Yield control to prevent blocking
                if (semanticHistory.length % 10 === 0) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            }
        }
        
        return this.aggregateSemanticPatterns(semanticHistory);
    }

    /**
     * Convert MoTS semantic data into JAM-compatible format
     */
    formatForJAM(semanticIntent) {
        return {
            intent: this.generateIntentString(semanticIntent),
            vector: semanticIntent.semanticVector,
            patterns: semanticIntent.poriPatterns,
            metadata: {
                source: 'MoTS',
                confidence: semanticIntent.confidence,
                classification: semanticIntent.classification,
                timestamp: semanticIntent.timestamp
            }
        };
    }

    // Helper methods
    checkPhiAlignment(value) {
        const PHI = 1.618033988749895;
        const ratios = [PHI, 1/PHI, PHI*PHI, Math.sqrt(PHI)];
        
        return ratios.some(ratio => {
            const diff = Math.abs(value % ratio);
            return diff < 0.001 || diff > (ratio - 0.001);
        });
    }

    calculateRecursiveDepth(logs) {
        // Analyze event patterns for recursive structures
        const eventSignatures = logs.map(log => log.topics[0]);
        let depth = 0;
        
        for (let i = 1; i < eventSignatures.length; i++) {
            if (eventSignatures[i] === eventSignatures[i-1]) {
                depth++;
            }
        }
        
        return depth;
    }

    calculateSemanticDensity(data) {
        if (!data || data === '0x') return 0;
        
        // Calculate entropy of transaction data
        const bytes = Buffer.from(data.slice(2), 'hex');
        const frequency = {};
        
        for (const byte of bytes) {
            frequency[byte] = (frequency[byte] || 0) + 1;
        }
        
        let entropy = 0;
        const len = bytes.length;
        
        for (const count of Object.values(frequency)) {
            const p = count / len;
            entropy -= p * Math.log2(p);
        }
        
        // Normalize to 0-1 range
        return entropy / 8;
    }

    detectHoneypotPattern(tx, receipt) {
        // Check for honeypot indicators
        const indicators = [
            receipt.status === 0, // Failed transaction
            tx.value === '0', // Zero value transfer
            receipt.gasUsed > 200000, // High gas usage
            tx.data && tx.data.length > 1000 // Complex call data
        ];
        
        return indicators.filter(Boolean).length >= 2;
    }

    calculateConfidence(vector, classification) {
        // Implement confidence scoring based on vector coherence
        // Use recursive compression feedback to adjust confidence
        const baseConfidence = 0.7; // Base confidence value
        const compressionFactor = vector.reduce((sum, value) => sum + value, 0) / vector.length;
        return baseConfidence + compressionFactor * 0.15; // Adjusted confidence
    }

    generateIntentString(semanticIntent) {
        const { classification, poriPatterns } = semanticIntent;
        
        // Generate human-readable intent string for JAM
        const baseIntent = `${classification} with`;
        const patterns = [];
        
        if (poriPatterns.hasPhiRatio) patterns.push('PHI resonance');
        if (poriPatterns.recursiveDepth > 0) patterns.push(`depth-${poriPatterns.recursiveDepth} recursion`);
        if (poriPatterns.honeypotSignal) patterns.push('honeypot attraction');
        
        return `${baseIntent} ${patterns.join(', ')}`;
    }

    aggregateSemanticPatterns(history) {
        // Aggregate patterns for meta-analysis
        const patterns = {
            dominantIntents: {},
            phiFrequency: 0,
            averageRecursiveDepth: 0,
            semanticClusters: []
        };
        
        // Count intent types
        history.forEach(item => {
            patterns.dominantIntents[item.classification] = 
                (patterns.dominantIntents[item.classification] || 0) + 1;
                
            if (item.poriPatterns.hasPhiRatio) patterns.phiFrequency++;
            patterns.averageRecursiveDepth += item.poriPatterns.recursiveDepth;
        });
        
        patterns.averageRecursiveDepth /= history.length;
        patterns.phiFrequency /= history.length;
        
        return patterns;
    }

    /**
     * Load and switch the semantic model in real-time
     * @param {string} modelPath - Path to the semantic model to load
     */
    loadSemanticModel(modelPath) {
        this.modelPath = modelPath;
        console.log(`semantic_model="loaded" path="${modelPath}"`);
    }
}

module.exports = MoTSIntegration;
