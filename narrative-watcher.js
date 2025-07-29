// narrative-watcher.js - Autonomous narrative detection and semantic retraining
// Monitors external feeds and triggers targeted model updates

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Parser = require('rss-parser');
const parser = new Parser();
const lunarClock = require('./tools/lunar-clock');
const NARRATIVE_STATE_FILE = path.join(__dirname, 'narrative-state.json');

let narrativeState = {
    processedEvents: new Set(),
    activeNarrative: 'default',
    lastCheck: Date.now(),
    narrativeHistory: []
};

// Load persisted state
function loadNarrativeState() {
    try {
        if (fs.existsSync(NARRATIVE_STATE_FILE)) {
            const data = JSON.parse(fs.readFileSync(NARRATIVE_STATE_FILE, 'utf8'));
            narrativeState.processedEvents = new Set(data.processedEvents || []);
            narrativeState.activeNarrative = data.activeNarrative || 'default';
            narrativeState.lastCheck = data.lastCheck || Date.now();
            narrativeState.narrativeHistory = data.narrativeHistory || [];
        }
    } catch (e) {
        if (e && /unexpected token|json/i.test(e.message)) {
            // Rare noisy error on bad JSON
            console.warn(`state_load_warn="bad_state_json, auto-recovery" error="${e.message.slice(0,80)}..."`);
        } else {
            console.log(`state_load_err="${e.message}"`);
        }
    }
}

// Save state to disk
function saveNarrativeState() {
    try {
        const data = {
            processedEvents: Array.from(narrativeState.processedEvents),
            activeNarrative: narrativeState.activeNarrative,
            lastCheck: narrativeState.lastCheck,
            narrativeHistory: narrativeState.narrativeHistory.slice(-100) // Keep last 100
        };
        fs.writeFileSync(NARRATIVE_STATE_FILE, JSON.stringify(data, null, 2));
    } catch (e) {
        console.log(`state_save_err="${e.message}"`);
    }
}

// Generate event hash for deduplication
function getEventHash(event) {
    return crypto.createHash('sha256')
        .update(JSON.stringify(event))
        .digest('hex')
        .slice(0, 16);
}

// Trigger narrative retraining with enhanced error handling
async function triggerNarrativeTraining(narrative, startBlock, endBlock) {
    console.log(`narrative_train="trigger" target="${narrative}" blocks="${startBlock}-${endBlock}"`);
    
    return new Promise((resolve, reject) => {
        const trainCommand = `node ${path.join(__dirname, 'tools/narrative-trainer.js')} ${narrative} ${startBlock} ${endBlock}`;
        
        const child = exec(trainCommand, {
            timeout: 360000, // 6 minute timeout (longer than trainer's 5 min)
            killSignal: 'SIGTERM',
            maxBuffer: 1024 * 1024 * 10 // 10MB buffer
        }, (err, stdout, stderr) => {
            if (err) {
                // Enhanced error categorization
                const errorMessage = err.message || err.toString();
                const isTimeout = err.killed || err.signal === 'SIGTERM' || /timeout/i.test(errorMessage);
                const isNetworkError = /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|fetch/i.test(errorMessage);
                const isPermissionError = /EACCES|EPERM/i.test(errorMessage);
                const isPythonError = /python|scrapy|module/i.test(errorMessage);
                
                // Truncate messages for cleaner logs
                const truncatedError = errorMessage.length > 300 ? 
                    errorMessage.slice(0, 300) + '...(truncated)' : errorMessage;
                const truncatedStderr = stderr && stderr.length > 400 ? 
                    stderr.slice(0, 400) + '...(truncated)' : stderr;
                
                // Log error with category
                let errorCategory = 'general';
                if (isTimeout) errorCategory = 'timeout';
                else if (isNetworkError) errorCategory = 'network';
                else if (isPermissionError) errorCategory = 'permission';
                else if (isPythonError) errorCategory = 'python_env';
                
                console.error(`train_err="${truncatedError}" category="${errorCategory}" narrative="${narrative}"`);
                
                if (truncatedStderr && truncatedStderr.trim()) {
                    console.error(`train_stderr="${truncatedStderr}"`);
                }
                
                // Provide specific guidance based on error type
                if (isTimeout) {
                    console.warn(`timeout_guidance="Training exceeded time limit. Consider reducing block range (currently ${endBlock - startBlock} blocks) or check system resources."`);
                } else if (isNetworkError) {
                    console.warn(`network_guidance="Network connectivity issue during training. The system will retry with fallback model."`);
                } else if (isPermissionError) {
                    console.warn(`permission_guidance="File system permission error. Check write access to models directory."`);
                } else if (isPythonError) {
                    console.warn(`python_guidance="Python environment issue. Check MoTS virtual environment setup."`);
                }
                
                reject(new Error(`Training failed for ${narrative} with blocks ${startBlock}-${endBlock} (${errorCategory})`));
            } else {
                // Filter and clean stdout for better log readability
                if (stdout && stdout.trim()) {
                    const cleanOutput = stdout
                        .split('\n')
                        .filter(line => {
                            // Keep important status messages, filter noise
                            return line.includes('train_status') || 
                                   line.includes('narrative_train') ||
                                   line.includes('next_step') ||
                                   line.includes('model_size') ||
                                   (!line.includes('scrapy') && !line.includes('Overridden') && line.trim().length > 0);
                        })
                        .join('\n')
                        .trim();
                    
                    if (cleanOutput) {
                        console.log(`train_output="${cleanOutput}"`);
                    }
                }
                
                console.log(`train_success="completed" narrative="${narrative}" blocks="${startBlock}-${endBlock}"`);
                resolve();
            }
        });
        
        // Handle process errors
        child.on('error', (error) => {
            console.error(`train_process_err="${error.message}" narrative="${narrative}"`);
            reject(error);
        });
        
        // Log training start
        console.log(`train_exec="started" narrative="${narrative}" timeout="6min" pid=${child.pid}`);
    });
}

// Update active narrative in ecosystem
async function updateActiveNarrative(narrative) {
    // Update .env file or signal file for PM2 to pick up
    const envPath = path.join(__dirname, '.narrative-active');
    fs.writeFileSync(envPath, narrative);
    
    // ALIGNED: No longer restart engine - let it complete its semantic mining
    console.log(`narrative_switch="recorded" narrative="${narrative}" restart="disabled_for_alignment"`);
    
    // Just update state without interrupting the recursive semantic loop
    narrativeState.activeNarrative = narrative;
    saveNarrativeState();
    
    console.log(`narrative_active="${narrative}" semantic_mining="uninterrupted"`);
    
    // The engine will pick up the new narrative on its next natural cycle
    // This respects the cosmic timing and JAM emission windows
}

// Foundational Narrative Anchors - Hierarchical consensus layers
// Anchor confidence weights based on foundational consensus
const ANCHOR_WEIGHTS = {
    regulatory: 0.95,    // SEC/Legal = institutional ground truth
    github: 0.90,       // Protocol commits = proto-semantic signals
    dao: 0.85          // Governance = treasury-backed intent
};

async function checkNarrativeFeeds() {
    const narratives = [];
    
    try {
        // TIER 1: SEC/Regulatory - Foundational legal consensus
        const regulatoryEvents = await checkRegulatoryFeeds();
        narratives.push(...regulatoryEvents);
        
        // TIER 2: GitHub Protocol Commits - Proto-semantic signals
        const githubEvents = await checkGitHubFeeds();
        narratives.push(...githubEvents);
        
        // TIER 3: DAO Governance - On-chain intent manifests
        const daoEvents = await checkDAOFeeds();
        narratives.push(...daoEvents);
        
    } catch (e) {
        console.log(`feed_check_err="${e.message}"`);
    }
    
    return narratives.filter(event => {
        const hash = getEventHash(event);
        return !narrativeState.processedEvents.has(hash);
    });
}

// TIER 1: SEC/Regulatory feeds - Institutional ground truth
async function checkRegulatoryFeeds() {
    const events = [];
    
    try {
        // SEC Final Rules
        const secFeed = await parser.parseURL('https://www.sec.gov/rss/rules/final.xml');
        for (const item of secFeed.items) {
            if (item.title && (item.title.includes('Ethereum') || 
                              item.title.includes('crypto') || 
                              item.title.includes('digital asset'))) {
                events.push({
                    type: 'regulatory',
                    narrative: detectRegulatoryNarrative(item.title),
                    confidence: ANCHOR_WEIGHTS.regulatory,
                    blockRange: estimateBlockRange(item.pubDate),
                    timestamp: new Date(item.pubDate).getTime(),
                    source: item.link,
                    tier: 1
                });
            }
        }
        
        // Add Federal Register, CFTC, Treasury feeds here
        
    } catch (e) {
        console.log(`regulatory_feed_err="${e.message}"`);
    }
    
    return events;
}

// TIER 2: GitHub feeds - Proto-semantic insider signals
async function checkGitHubFeeds() {
    const events = [];
    const repos = [
        'ethereum/consensus-specs',
        'ethereum/execution-specs',
        'ethereum/EIPs',
        'Uniswap/v4-core',
        'bitcoin-sv/bitcoin-sv'
    ];
    
    try {
        for (const repo of repos) {
            const feedUrl = `https://github.com/${repo}/commits.atom`;
            const feed = await parser.parseURL(feedUrl);
            
            for (const commit of feed.items.slice(0, 3)) {
                if (isSignificantCommit(commit.title)) {
                    events.push({
                        type: 'github_commit',
                        narrative: detectGitHubNarrative(commit.title, repo),
                        confidence: ANCHOR_WEIGHTS.github,
                        blockRange: estimateBlockRange(commit.pubDate),
                        timestamp: new Date(commit.pubDate).getTime(),
                        source: commit.link,
                        repo: repo,
                        tier: 2
                    });
                }
            }
        }
    } catch (e) {
        console.log(`github_feed_err="${e.message}"`);
    }
    
    return events;
}

// TIER 3: DAO Governance - Treasury-backed decisions
async function checkDAOFeeds() {
    const events = [];
    
    // Implement Tally.xyz RSS, Snapshot API polling
    // Look for high-value proposals (>$1M treasury impact)
    
    return events;
}

// Narrative detection helpers
function detectRegulatoryNarrative(title) {
    if (title.includes('ETF')) return 'eth-etf';
    if (title.includes('custody')) return 'custody-rules';
    if (title.includes('stablecoin')) return 'stablecoin-reg';
    return 'regulatory-shift';
}

function detectGitHubNarrative(title, repo) {
    if (title.includes('EIP-')) return `eip-${title.match(/EIP-(\d+)/)?.[1] || 'update'}`;
    if (title.includes('danksharding')) return 'danksharding';
    if (title.includes('MEV')) return 'mev-update';
    if (repo.includes('Uniswap')) return 'uniswap-v4';
    return 'protocol-update';
}

function isSignificantCommit(title) {
    const keywords = ['EIP', 'upgrade', 'fork', 'MEV', 'consensus', 'merge', 'withdraw'];
    return keywords.some(keyword => title.toLowerCase().includes(keyword.toLowerCase()));
}

// Estimate block range based on event timestamp
function estimateBlockRange(eventTime) {
    const BLOCKS_PER_DAY = 7200;
    const eventTimestamp = new Date(eventTime).getTime();
    const currentTime = Date.now();
    const timeDiff = (eventTimestamp - currentTime) / 1000;
    const blockDiff = Math.floor(timeDiff / 12);
    const currentBlock = 20500000;
    const targetBlock = currentBlock + blockDiff;
    return [targetBlock - 50, targetBlock + 50];
}

// Main monitoring loop
async function monitorNarratives() {
    try {
        const events = await checkNarrativeFeeds();
        
        // Sort by tier (1=highest priority) then confidence
        events.sort((a, b) => {
            if (a.tier !== b.tier) return a.tier - b.tier;
            return b.confidence - a.confidence;
        });
        
        for (const event of events) {
            const hash = getEventHash(event);
            
            // Skip if already processed
            if (narrativeState.processedEvents.has(hash)) continue;
            
            // Learn cosmic semantics from RSS feed
            const semanticWeight = lunarClock.learnFromRSSSemantics(event);
            
            // Amplify confidence with cosmic resonance
            const cosmicResonance = lunarClock.calculateCosmicResonance();
            const amplifiedConfidence = event.confidence * cosmicResonance.total;
            
            console.log(`narrative_event="detected" tier=${event.tier} type="${event.type}" narrative="${event.narrative}" confidence=${event.confidence} cosmic_amp=${cosmicResonance.total.toFixed(3)} semantic_weight=${semanticWeight}`);
            
            // Process based on tier and cosmic-amplified confidence
            const shouldProcess = 
                (event.tier === 1 && amplifiedConfidence >= 0.9) ||  // Regulatory: 90%+
                (event.tier === 2 && amplifiedConfidence >= 0.85) || // GitHub: 85%+
                (event.tier === 3 && amplifiedConfidence >= 0.8);    // DAO: 80%+
            
            if (shouldProcess && event.blockRange) {
                let attempts = 0;
                const maxAttempts = 2;
                let success = false;
                
                while (attempts < maxAttempts && !success) {
                    attempts++;
                    try {
                        console.log(`narrative_attempt="${attempts}/${maxAttempts}" narrative="${event.narrative}"`);
                        
                        await triggerNarrativeTraining(
                            event.narrative,
                            event.blockRange[0],
                            event.blockRange[1]
                        );
                        
                        // Switch to new narrative if training succeeded
                        await updateActiveNarrative(event.narrative);
                        
                        // Track in history with tier info
                        narrativeState.narrativeHistory.push({
                            hash,
                            narrative: event.narrative,
                            tier: event.tier,
                            type: event.type,
                            confidence: event.confidence,
                            timestamp: Date.now(),
                            blockRange: event.blockRange,
                            attempts: attempts
                        });
                        
                        console.log(`narrative_activated="${event.narrative}" tier=${event.tier} attempts=${attempts}`);
                        success = true;
                        
                    } catch (e) {
                        console.error(`narrative_attempt_failed="${attempts}/${maxAttempts}" narrative="${event.narrative}" error="${e.message}"`);
                        
                        if (attempts >= maxAttempts) {
                            console.error(`narrative_process_err="max_attempts_reached" narrative="${event.narrative}" final_error="${e.message}"`);
                            
                            // Mark as failed in history
                            narrativeState.narrativeHistory.push({
                                hash,
                                narrative: event.narrative,
                                tier: event.tier,
                                type: event.type,
                                confidence: event.confidence,
                                timestamp: Date.now(),
                                blockRange: event.blockRange,
                                attempts: attempts,
                                status: 'failed',
                                error: e.message
                            });
                        } else {
                            // Wait 5 seconds before retry
                            await new Promise(resolve => setTimeout(resolve, 5000));
                        }
                    }
                }
            }
            
            // Mark as processed
            narrativeState.processedEvents.add(hash);
        }
        
        narrativeState.lastCheck = Date.now();
        saveNarrativeState();
        
    } catch (error) {
        if (error.message && (
            /ECONNRESET|ETIMEDOUT|network|ENOTFOUND|EAI_AGAIN|fetch/i.test(error.message))) {
            // Suppress spammy network fetch errors; log one line summary
            console.warn(`narrative_network_err="suppressed: ${error.message.slice(0,70)}..."`);
        } else {
            console.log(`monitor_err="${error.message}"`);
        }
    }
}

// Initialize
loadNarrativeState();
console.log(`narrative_watcher="init" active="${narrativeState.activeNarrative}"`);

// Check every 5 minutes
setInterval(monitorNarratives, 5 * 60 * 1000);

// Initial check
monitorNarratives();

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('narrative_watcher="shutdown"');
    saveNarrativeState();
    process.exit(0);
});
