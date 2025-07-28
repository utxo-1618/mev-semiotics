// Mock implementation of jam-store.js
// This provides basic storage functionality for signal data

const fs = require('fs');
const path = require('path');

// In-memory storage
const store = new Map();

// File-based persistence
const STORE_FILE = path.join(__dirname, 'data', 'jam-store.json');
const SUCCESSFUL_DIR = path.join(__dirname, 'jams', 'successful');
const SUCCESSFUL_FILE = path.join(SUCCESSFUL_DIR, 'successful-jams.jsonl');

// Ensure data directories exist
try {
    if (!fs.existsSync(path.join(__dirname, 'data'))) {
        fs.mkdirSync(path.join(__dirname, 'data'));
    }
    if (!fs.existsSync(path.join(__dirname, 'jams'))) {
        fs.mkdirSync(path.join(__dirname, 'jams'));
    }
    if (!fs.existsSync(SUCCESSFUL_DIR)) {
        fs.mkdirSync(SUCCESSFUL_DIR, { recursive: true });
    }
} catch (e) {
    console.warn('Could not create directories:', e.message);
}

// Load existing data if available
try {
    if (fs.existsSync(STORE_FILE)) {
        const data = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
        Object.entries(data).forEach(([key, value]) => store.set(key, value));
    }
} catch (e) {
    console.warn('Could not load existing jam-store data:', e.message);
}

// Save to file periodically
setInterval(() => {
    try {
        const data = {};
        store.forEach((value, key) => data[key] = value);
        fs.writeFileSync(STORE_FILE, JSON.stringify(data, null, 2));
    } catch (e) {
        console.warn('Could not save jam-store data:', e.message);
    }
}, 60000);

module.exports = {
    // Store signal data
    update: (hash, data) => {
        const existing = store.get(hash) || {};
        store.set(hash, { ...existing, ...data });
        return true;
    },

    // Retrieve signal data
    retrieve: (hash) => {
        return store.get(hash) || {
            meta: { audit_pass: true }, // Default to passing audit
            proverb: [], // Empty proverb array
            cascadeDepth: 1 // Default cascade depth
        };
    },

    // Delete signal data
    delete: (hash) => {
        return store.delete(hash);
    },

    // Get all stored signals
    getAll: () => {
        return Array.from(store.entries()).map(([hash, data]) => ({
            hash,
            ...data
        }));
    },

    // Reinforce successful signal
    reinforceSignal: (signalHash, yieldAmount = 0) => {
        const jam = store.get(signalHash);
        if (!jam) return false;
        
        // PHI constant for recursive amplification
        const PHI = 1.618033988749895;
        
        // Increase cascade depth
        jam.cascadeDepth = (jam.cascadeDepth || 1) + 1;
        
        // Amplify semantic density by PHI
        if (!jam.meta) jam.meta = {};
        jam.meta.semantic_density = (jam.meta.semantic_density || 1) * PHI;
        
        // Track reinforcement history
        if (!jam.reinforcements) jam.reinforcements = [];
        jam.reinforcements.push({
            timestamp: Date.now(),
            yieldAmount: yieldAmount,
            depth: jam.cascadeDepth
        });
        
        // Update causal strength
        jam.causalStrength = (jam.causalStrength || 1) * Math.pow(PHI, 1 / jam.cascadeDepth);
        
        // Track narrative-specific performance
        const narrative = jam.meta?.narrative || 'default';
        if (!jam.narrativePerformance) jam.narrativePerformance = {};
        if (!jam.narrativePerformance[narrative]) {
            jam.narrativePerformance[narrative] = {
                totalYield: 0,
                reinforcements: 0,
                avgYield: 0
            };
        }
        jam.narrativePerformance[narrative].totalYield += yieldAmount;
        jam.narrativePerformance[narrative].reinforcements += 1;
        jam.narrativePerformance[narrative].avgYield = 
            jam.narrativePerformance[narrative].totalYield / 
            jam.narrativePerformance[narrative].reinforcements;
        
        // Mark as high-yield if successful
        if (yieldAmount > 0) {
            jam.meta.high_yield = true;
            jam.meta.total_yield = (jam.meta.total_yield || 0) + yieldAmount;
            
            // Save compressed successful JAM
            this.saveSuccessfulJAM(signalHash, jam);
        }
        
        store.set(signalHash, jam);
        console.log(`jam_reinforced="${signalHash.slice(0,10)}" depth="${jam.cascadeDepth}" strength="${jam.causalStrength.toFixed(3)}" narrative="${narrative}"`);
        
        return true;
    },

    // Get high-yield JAMs for re-emission
    getHighYieldJams: (minYield = 0) => {
        const highYield = [];
        
        for (const [hash, jam] of store.entries()) {
            if (jam.meta?.high_yield && (jam.meta.total_yield || 0) >= minYield) {
                highYield.push({
                    hash,
                    ...jam,
                    score: (jam.cascadeDepth || 1) * (jam.causalStrength || 1) * (jam.meta.semantic_density || 1)
                });
            }
        }
        
        // Sort by score descending
        return highYield.sort((a, b) => b.score - a.score);
    },
    
    // Get performance stats by narrative
    getNarrativePerformance: () => {
        const narrativeStats = {};
        
        for (const [hash, jam] of store.entries()) {
            if (jam.narrativePerformance) {
                Object.entries(jam.narrativePerformance).forEach(([narrative, stats]) => {
                    if (!narrativeStats[narrative]) {
                        narrativeStats[narrative] = {
                            totalYield: 0,
                            totalSignals: 0,
                            avgYieldPerSignal: 0,
                            highYieldSignals: 0
                        };
                    }
                    narrativeStats[narrative].totalYield += stats.totalYield;
                    narrativeStats[narrative].totalSignals += 1;
                    if (stats.totalYield > 0) {
                        narrativeStats[narrative].highYieldSignals += 1;
                    }
                });
            }
        }
        
        // Calculate averages
        Object.keys(narrativeStats).forEach(narrative => {
            const stats = narrativeStats[narrative];
            stats.avgYieldPerSignal = stats.totalSignals > 0 ? 
                stats.totalYield / stats.totalSignals : 0;
        });
        
        return narrativeStats;
    },
    
    // Save successful JAM in compressed format
    saveSuccessfulJAM: function(signalHash, jam) {
        try {
            // Extract cosmic metadata
            const cosmicData = jam.cosmic || {};
            const mevTags = cosmicData.mev_tags || [];
            
            // Create compressed JAM format (5 lines as requested)
            const compressedJAM = {
                timestamp: Date.now(),
                resonance: jam.resonance || cosmicData.resonance || 1.0,
                intent_class: cosmicData.mev_metadata?.intent_class || 'STANDARD',
                mev_tags: mevTags,
                signalHash: signalHash
            };
            
            // Append to JSONL file
            fs.appendFileSync(SUCCESSFUL_FILE, JSON.stringify(compressedJAM) + '\n');
            
            // Also save individual file for high-yield JAMs (total_yield > 0.001 ETH)
            if (jam.meta?.total_yield > 0.001) {
                const individualFile = path.join(
                    SUCCESSFUL_DIR, 
                    `jam-${signalHash.slice(0,10)}-${compressedJAM.timestamp}.json`
                );
                fs.writeFileSync(individualFile, JSON.stringify(compressedJAM, null, 2));
            }
            
            console.log(`successful_jam_saved="${signalHash.slice(0,10)}" resonance="${compressedJAM.resonance}" intent="${compressedJAM.intent_class}"`);
        } catch (e) {
            console.warn('Could not save successful JAM:', e.message);
        }
    },
    
    // Retrieve all successful JAMs
    getSuccessfulJAMs: function() {
        try {
            if (!fs.existsSync(SUCCESSFUL_FILE)) {
                return [];
            }
            
            const lines = fs.readFileSync(SUCCESSFUL_FILE, 'utf8').split('\n').filter(line => line.trim());
            return lines.map(line => {
                try {
                    return JSON.parse(line);
                } catch (e) {
                    return null;
                }
            }).filter(jam => jam !== null);
        } catch (e) {
            console.warn('Could not read successful JAMs:', e.message);
            return [];
        }
    },
    
    // Get successful JAMs by intent class
    getSuccessfulJAMsByIntent: function(intentClass) {
        const allJAMs = this.getSuccessfulJAMs();
        return allJAMs.filter(jam => jam.intent_class === intentClass);
    },
    
    // Get successful JAMs by MEV tag
    getSuccessfulJAMsByTag: function(tag) {
        const allJAMs = this.getSuccessfulJAMs();
        return allJAMs.filter(jam => jam.mev_tags && jam.mev_tags.includes(tag));
    }
};
