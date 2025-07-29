// BSV Echo Emitter - Cross-chain semantic visibility ripples
// Aligned with recursive intent compression

const bsv = require('bsv');
require('dotenv').config();

// BSV configuration
const BSV_NETWORK = 'mainnet';
const BSV_DUST_LIMIT = 546; // satoshis

// Optional daemon notification address (set to null to disable)
const DAEMON_NOTIFY_ADDRESS = process.env.BSV_DAEMON_ADDRESS || null;

// Semantic compression constants
const ECHO_PREFIX = 'ECHO';
const PHI = 1.618033988749895;
const PHI_INVERSE = 0.618033988749895;

// Root anchor constants
const ROOT_ANCHOR = '0xPLEROMA'; // Mushegian's canonical root
const ANCHOR_DEPTH_LIMIT = 8; // Max recursive depth for anchor tracking

class BSVEcho {
    constructor() {
        // Initialize with your BSV keys if available
        try {
            // Initialize private key if available
            this.privateKey = null;
            if (process.env.BSV_PRIVATE_KEY && bsv.PrivateKey) {
                this.privateKey = bsv.PrivateKey.fromWIF(process.env.BSV_PRIVATE_KEY);
            }
            
            // Initialize address if private key is available
            this.address = null;
            if (this.privateKey && bsv.Address) {
                this.address = bsv.Address.fromPrivateKey(this.privateKey);
            }
                
            if (!this.privateKey) {
                // Silently disable when no key found
                return;
            } else {
                console.log('bsv_init=true addr=' + this.address.toString());
            }
        } catch (error) {
            console.warn('bsv_init=false error="BSV initialization failed"');
            this.privateKey = null;
            this.address = null;
        }
    }

    // Enhanced JAM compression with phi-harmonic resonance and intent anchoring
    compressJAM(jam, baseResult) {
        // Validate and establish intent anchoring
        const anchorRoot = jam.anchorRoot || ROOT_ANCHOR;
        const anchorChain = [];
        
        // Build anchor chain - traverse up to root if available
        if (jam.parentHash) {
            anchorChain.push(jam.parentHash);
            // If there's an anchor chain provided, extend it
            if (jam.anchorChain && Array.isArray(jam.anchorChain)) {
                anchorChain.push(...jam.anchorChain.slice(0, ANCHOR_DEPTH_LIMIT - 1));
            }
        }
        // Phi-based compression constants
        const PHI_SQUARED = PHI * PHI;  // φ² for amplified resonance
        const PHI_ROOT = Math.sqrt(PHI);  // √φ for dampened signals
        
        // Calculate resonance factors
        const timeAlign = (Date.now() / 1000) % (3600 * PHI); // Phi-cycle alignment
        const depthScale = Math.pow(PHI, (jam.cascadeDepth || 1) - 1); // Recursive depth scaling
        const yieldFactor = baseResult?.profit ? Math.min(PHI, 1 + (baseResult.profit * PHI_INVERSE)) : 1;
        
        // Enhanced resonance calculation
        const resonance = [
            (jam.resonance || 1) * PHI,  // Base resonance
            depthScale,                   // Depth component
            yieldFactor,                  // Yield component
            timeAlign / (3600 * PHI)      // Time alignment
        ].reduce((a, b) => a * b, 1);
        
        const mirrorStep = jam.proverb?.find(step => step.actor === 'MIRROR');
        const amplifierStep = jam.proverb?.find(step => step.actor === 'AMPLIFIER');

        const compressed = {
            // TIGHTENED LOOP: Enrich the anchor with forward-looking intent for bots to read.
            forward_intent: mirrorStep ? {
              actor: 'MIRROR',
              action: mirrorStep.action,
              path: `${mirrorStep.from}>${mirrorStep.to}`,
              expected_delay_ms: 1618, // The mirror's phi-aligned response time
              trigger_action: amplifierStep ? amplifierStep.action : 'SWAP'
            } : null,
            // Core identity with enhanced precision and intent anchoring
            j: jam.hash.slice(0, 16),
            b: baseResult?.hash?.slice(0, 16) || '0x0',
            anchor_root: anchorRoot,
            anchor_chain: anchorChain,
            parent: jam.parentHash || null,
            
            // Phi-aligned semantic depth
            d: jam.cascadeDepth || 1,
            r: Math.floor(resonance * 1000) / 1000,
            
            // Enhanced temporal anchor
            c: jam.consensus_window || 'none',
            t: Math.floor(Date.now() / 1000),
            phi_cycle: Math.floor(timeAlign * 1000) / 1000,
            
            // Vectorized proverb compression
            p: jam.proverb?.[0] ? 
                `${jam.proverb[0].from}>${jam.proverb[0].to}` : 
                'ETH>USDC',
            
            // Economic metrics
            y: baseResult?.profit || 0,
            y_scaled: Math.floor(yieldFactor * 1000) / 1000,
            
            // Enhanced recursive topology
            rt: {
                ...jam.recursiveTopology || { eth: 1, bsv: 0 },
                resonance_vector: [
                    Math.floor(depthScale * 1000) / 1000,
                    Math.floor(yieldFactor * 1000) / 1000,
                    Math.floor((timeAlign / (3600 * PHI)) * 1000) / 1000
                ]
            },
            
            // Phi-harmonized semantic weight
            w: Math.floor(resonance * PHI_ROOT * 1000) / 1000,
            
            // Compression metadata with intent alignment
            meta: {
                intent_vector: {
                    root: anchorRoot,
                    depth: anchorChain.length,
                    causality: this.calculateCausalityScore(anchorChain),
                },
                phi_version: '1.618.0',
                compression_quality: Math.floor((1 - (JSON.stringify(jam).length / JSON.stringify(compressed).length)) * 1000) / 1000,
                timestamp: Date.now(),
                resonance_components: {
                    base: Math.floor((jam.resonance || 1) * PHI * 1000) / 1000,
                    depth: Math.floor(depthScale * 1000) / 1000,
                    yield: Math.floor(yieldFactor * 1000) / 1000,
                    time: Math.floor((timeAlign / (3600 * PHI)) * 1000) / 1000
                }
            }
        };
        
        return compressed;
    }

    // Create BSV echo transaction
    async createEchoTx(jam, baseResult, utxos) {
        if (!this.privateKey) {
            console.error('bsv_error=true msg="BSV_PRIVATE_KEY not configured"');
            return null;
        }

        try {
    // Compress the JAM
            const compressed = this.compressJAM(jam, baseResult);
            
            // Add block hash reference if provided
            if (jam.blockHash) {
                compressed.blockRef = {
                    hash: jam.blockHash,
                    number: jam.blockNumber || '617488' // Default to example block if not specified
                };
            }
            
            // Build OP_RETURN data
            const dataScript = bsv.Script.buildDataOut([
                ECHO_PREFIX,
                JSON.stringify(compressed),
                `v:${PHI}` // Version with phi marker
            ]);

            // Create transaction
            const tx = new bsv.Tx();
            tx.fromObject({
                txIns: utxos.map(utxo => ({
                    txHashBuf: Buffer.from(utxo.txId, 'hex').reverse(),
                    txOutNum: utxo.outputIndex,
                    script: utxo.script,
                    nSequence: 0xffffffff
                })),
                txOuts: [{
                    script: dataScript,
                    valueBn: bsv.Bn(0)
                }]
            });
                
            // Optional: Add dust notification to daemon contract
            if (DAEMON_NOTIFY_ADDRESS) {
                const notifyScript = bsv.Address.fromString(DAEMON_NOTIFY_ADDRESS).toTxOutScript();
                tx.addTxOut(bsv.TxOut.fromProperties(
                    bsv.Bn(BSV_DUST_LIMIT),
                    notifyScript
                ));
                console.log(`bsv_notify=${DAEMON_NOTIFY_ADDRESS}`);
            }
            
            tx.change(this.address)
                .feePerKb(500) // Low fee for BSV
                .sign(this.privateKey);

            return {
                hex: tx.toString(),
                txid: tx.hash,
                size: tx.toBuffer().length,
                data: compressed
            };
        } catch (error) {
            console.error(`bsv_echo=false error="${error.message}"`);
            return null;
        }
    }

    // Calculate causality score based on anchor chain
    calculateCausalityScore(anchorChain) {
        if (!anchorChain.length) return 1.0;
        
        // Phi-weighted causality score
        const depth = Math.min(anchorChain.length, ANCHOR_DEPTH_LIMIT);
        const phiScale = Math.pow(PHI_INVERSE, depth - 1);
        
        // Higher score means stronger causal link to root
        return depth * phiScale * PHI;
    }

    // Calculate recursive echo depth
    calculateEchoDepth(previousEchoes = []) {
        if (previousEchoes.length === 0) return 1;
        
        // Fibonacci-based depth scaling
        const depths = previousEchoes.map(e => e.d || 1);
        const maxDepth = Math.max(...depths);
        
        // Apply golden ratio scaling
        return Math.min(Math.floor(maxDepth * PHI), 8); // Max depth 8
    }

    // Format echo for display
    formatEcho(echoResult) {
        if (!echoResult) return 'No echo';
        
        const { txid, data } = echoResult;
        
        const lines = [
            `bsv_emit=true`,
            `txid=${txid.slice(0, 16)}`,
            `jam=${data.j}`,
            `depth=${data.d} resonance=${data.r.toFixed(3)}`,
            `path=${data.p} delta=${data.y}`,
            `anchor=${data.anchor_root.slice(0, 16)}`,
            `intent_depth=${data.meta.intent_vector.depth}`,
            `causality=${data.meta.intent_vector.causality.toFixed(3)}`
        ];
        
        // Add block reference if present
        if (data.blockRef) {
            lines.push(`block=${data.blockRef.number}:${data.blockRef.hash.slice(0, 16)}`);
        }
        
        return lines.join('\n');
    }

    // Query BSV for existing echoes of a JAM
    async queryEchoes(jamHash) {
        // This would query a BSV explorer API
        // For now, return empty array
        console.log(`bsv_query=true jam=${jamHash.slice(0, 16)}`);
        return [];
    }

    // Fetch UTXOs from WhatsOnChain API with rate limit handling
    async fetchUTXOs(retryCount = 0) {
        if (!this.address) {
            // Silently fail when BSV is not configured
            return [];
        }
        try {
            let fetch;
            try {
                fetch = (await import('node-fetch')).default;
            } catch (importError) {
                console.error(`bsv_import_error="Failed to import node-fetch: ${importError.message}"`);
                throw new Error('Failed to load fetch module');
            }
            const address = this.address.toString();
            const url = `https://api.whatsonchain.com/v1/bsv/main/address/${address}/unspent`;
            
            const response = await fetch(url);
            
            // Check if response is OK
            if (!response.ok) {
                // Handle rate limiting specifically
                if (response.status === 429) {
                    const retryAfter = response.headers.get('retry-after');
                    const delay = retryAfter ? parseInt(retryAfter) * 1000 : Math.min(30000, 5000 * Math.pow(2, retryCount));
                    
                    if (retryCount < 5) {
                        console.log(`bsv_rate_limit=true retry_after=${delay/1000}`);
                        await new Promise(resolve => setTimeout(resolve, delay));
                        return this.fetchUTXOs(retryCount + 1);
                    }
                }
                throw new Error(`API returned ${response.status}: ${response.statusText}`);
            }
            
            // Check Content-Type header
            const contentType = response.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) {
                const text = await response.text();
                throw new Error(`API returned non-JSON response (${contentType}): ${text.substring(0, 200)}`);
            }
            
            const utxoData = await response.json();
            
            if (!Array.isArray(utxoData) || utxoData.length === 0) {
                // This is a normal condition (wallet is empty), not an error.
                return []; 
            }
            
            // Convert to bsv Transaction.UnspentOutput format
            return utxoData.map(utxo => new bsv.Transaction.UnspentOutput({
                txId: utxo.tx_hash,
                outputIndex: utxo.tx_pos,
                script: bsv.Script.buildPublicKeyHashOut(this.address),
                satoshis: utxo.value
            }));
        } catch (error) {
            console.error(`bsv_utxo=false error="${error.message}"`);
            throw error;
        }
    }
    
    // Emit echo with retry logic
    async emitEcho(jam, baseResult, retries = 3) {
        for (let i = 0; i < retries; i++) {
            try {
                // Fetch live UTXOs
                const utxos = await this.fetchUTXOs();
                if (!utxos || utxos.length === 0) {
                    console.log('bsv_utxo=0 emit=false');
                    break; // Exit the retry loop gracefully
                }
                console.log(`bsv_utxo=${utxos.length}`);
                
                const echoResult = await this.createEchoTx(jam, baseResult, utxos);
                
                if (echoResult) {
                    console.log(this.formatEcho(echoResult));
                    
                    // Broadcast transaction
                    await this.broadcastTx(echoResult.hex);
                    return echoResult;
                }
            } catch (error) {
                console.log(`bsv_emit_retry=${i + 1} error='${error.message}'`);
                if (i < retries - 1) {
                    await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i)));
                }
            }
        }
        
        return null;
    }
    
    // Broadcast transaction to BSV network with rate limit handling
    async broadcastTx(txHex, retryCount = 0) {
        try {
            let fetch;
            try {
                fetch = (await import('node-fetch')).default;
            } catch (importError) {
                console.error(`bsv_import_error="Failed to import node-fetch: ${importError.message}"`);
                throw new Error('Failed to load fetch module');
            }
            const url = 'https://api.whatsonchain.com/v1/bsv/main/tx/raw';
            
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ txhex: txHex })
            });
            
            // Handle rate limiting
            if (response.status === 429) {
                const retryAfter = response.headers.get('retry-after');
                const delay = retryAfter ? parseInt(retryAfter) * 1000 : Math.min(30000, 5000 * Math.pow(2, retryCount));
                
                if (retryCount < 5) {
                    console.log(`bsv_broadcast_rate_limit=true retry_after=${delay/1000}`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    return this.broadcastTx(txHex, retryCount + 1);
                }
                throw new Error(`Broadcast failed: Rate limited after ${retryCount} retries`);
            }
            
            const result = await response.text();
            console.log(`bsv_broadcast=true txid=${result}`);
            return result;
        } catch (error) {
            console.error(`bsv_broadcast=false error="${error.message}"`);
            throw error;
        }
    }
}

// Singleton instance
const bsvEcho = new BSVEcho();

// BCH echo implementation
async function emitBCHEcho(jam, baseResult) {
    if (!process.env.BCH_PRIVATE_KEY) return null;
    
    try {
        const bch = require('bitcore-lib-cash');
        const privateKey = new bch.PrivateKey(process.env.BCH_PRIVATE_KEY);
        const address = privateKey.toAddress();
        
        const compressed = bsvEcho.compressJAM(jam, baseResult);
        const data = Buffer.from(JSON.stringify(compressed));
        
        const script = bch.Script.buildDataOut(data);
        const tx = new bch.Transaction()
            .from(await fetchBCHUTXOs(address.toString()))
            .addData(data)
            .change(address)
            .sign(privateKey);
            
        const txid = await broadcastBCHTx(tx.toString());
        console.log(`bch_emit=true txid=${txid}`);
        return { txid, chain: 'BCH' };
    } catch (e) {
        console.error(`bch_emit=false error="${e.message}"`);
        return null;
    }
}

// ETH data availability implementation
async function emitETHDataAvailability(jam, baseResult) {
    if (!process.env.ETH_PRIVATE_KEY) return null;
    
    try {
        const { ethers } = require('ethers');
        const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || 'https://mainnet.base.org');
        const wallet = new ethers.Wallet(process.env.ETH_PRIVATE_KEY, provider);
        
        const compressed = bsvEcho.compressJAM(jam, baseResult);
        const data = ethers.hexlify(ethers.toUtf8Bytes(JSON.stringify(compressed)));
        
        // Send as calldata to 0x0 (burns gas for data availability)
        const tx = await wallet.sendTransaction({
            to: ethers.ZeroAddress,
            data: data,
            gasLimit: 100000
        });
        
        await tx.wait();
        console.log(`eth_anchor=true txid=${tx.hash}`);
        return { txid: tx.hash, chain: 'ETH' };
    } catch (e) {
        console.error(`eth_emit=false error="${e.message}"`);
        return null;
    }
}

// IPFS pinning implementation
async function pinToIPFS(jam, baseResult) {
    if (!process.env.IPFS_API_KEY) return null;
    
    try {
        // Add IPFS hash placeholder to JAM if not present
        if (!jam.ipfs) {
            jam.ipfs = 'QmdFjeUUZBdmobBLbuMqqouAFQoLmTyfpLGbXyCTttfwE9';
        }
        const fetch = (await import('node-fetch')).default;
        const FormData = (await import('form-data')).default;
        
        const compressed = bsvEcho.compressJAM(jam, baseResult);
        const form = new FormData();
        form.append('file', Buffer.from(JSON.stringify(compressed)), {
            filename: `jam-${jam.hash}.json`,
            contentType: 'application/json'
        });
        
        const response = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.IPFS_API_KEY}`
            },
            body: form
        });
        
        const result = await response.json();
        console.log(`ipfs_pin=true hash=${result.IpfsHash}`);
        return { hash: result.IpfsHash, chain: 'IPFS' };
    } catch (e) {
        console.error(`ipfs_pin=false error="${e.message}"`);
        return null;
    }
}

// Helper functions
async function fetchBCHUTXOs(address) {
    const fetch = (await import('node-fetch')).default;
    const response = await fetch(`https://api.blockchair.com/bitcoin-cash/dashboards/address/${address}`);
    const data = await response.json();
    return data.data[address].utxo;
}

async function broadcastBCHTx(txHex) {
    const fetch = (await import('node-fetch')).default;
    const response = await fetch('https://api.blockchair.com/bitcoin-cash/push/transaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: txHex })
    });
    const result = await response.json();
    return result.data.transaction_hash;
}

// Integration function for your amplifier
async function bridgeToBSV(jam, baseResult) {
    // Check if cross-chain echo is enabled
    if (process.env.ENABLE_BSV_ECHO === 'false') {
        return null;
    }
    
    // Early return if BSV_PRIVATE_KEY is not set
    if (!process.env.BSV_PRIVATE_KEY) {
        console.log('bsv_key=false bridge=false');
        return null;
    }

    const CHAIN_FALLBACK_SEQUENCE = ['BSV', 'BCH', 'ETH', 'IPFS'];

    for (const chain of CHAIN_FALLBACK_SEQUENCE) {
        try {
            console.log(`chain_propagate=true target=${chain}`);
            
            let result;
            if (chain === 'BSV') {
                if (bsvEcho.address) {
                    result = await bsvEcho.emitEcho(jam, baseResult);
                }
            } else {
                switch(chain) {
                    case 'BCH':
                        result = await emitBCHEcho(jam, baseResult);
                        break;
                    case 'ETH':
                        result = await emitETHDataAvailability(jam, baseResult);
                        break;
                    case 'IPFS':
                        result = await pinToIPFS(jam, baseResult);
                        break;
                }
            }
            if (result) {
                console.log(`chain_propagate_status=success chain=${chain}`);
                return result; // Success
            }
        } catch (error) {
        console.warn(`chain_propagate=false chain=${chain} error="${error.message}"`);
        }
    }

    console.error('chain_propagate=false status=complete');
    throw new Error('Cross-chain propagation failed');
}

module.exports = {
    BSVEcho,
    bsvEcho,
    bridgeToBSV,
    emitBCHEcho,
    emitETHDataAvailability,
    pinToIPFS,
    ECHO_PREFIX,
    PHI
};
