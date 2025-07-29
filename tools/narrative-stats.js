#!/usr/bin/env node
// tools/narrative-stats.js - View narrative performance statistics
// Usage: node tools/narrative-stats.js

const fs = require('fs');
const path = require('path');

// Import jam-store to access performance data
const jamStore = require('../jam-store');

// Load narrative state
const narrativeStateFile = path.join(__dirname, '..', 'narrative-state.json');
let narrativeState = { activeNarrative: 'default' };

try {
    if (fs.existsSync(narrativeStateFile)) {
        const data = JSON.parse(fs.readFileSync(narrativeStateFile, 'utf8'));
        narrativeState = data;
    }
} catch (e) {
    console.log(`state_load_err="${e.message}"`);
}

// Get narrative performance
const narrativePerformance = jamStore.getNarrativePerformance();

// Display stats
console.log(`narrative_stats="report" timestamp="${new Date().toISOString()}"`);
console.log(`active_narrative="${narrativeState.activeNarrative}"`);
console.log('');

if (Object.keys(narrativePerformance).length === 0) {
    console.log('no_data="true" message="No narrative performance data yet"');
} else {
    // Sort by total yield
    const sorted = Object.entries(narrativePerformance)
        .sort(([,a], [,b]) => b.totalYield - a.totalYield);
    
    sorted.forEach(([narrative, stats]) => {
        console.log(`narrative="${narrative}"`);
        console.log(`  total_yield="${stats.totalYield.toFixed(6)}"`);
        console.log(`  total_signals="${stats.totalSignals}"`);
        console.log(`  high_yield_signals="${stats.highYieldSignals}"`);
        console.log(`  avg_yield_per_signal="${stats.avgYieldPerSignal.toFixed(6)}"`);
        console.log(`  success_rate="${((stats.highYieldSignals / stats.totalSignals) * 100).toFixed(1)}%"`);
        console.log('');
    });
    
    // Summary
    const totalYield = sorted.reduce((sum, [,stats]) => sum + stats.totalYield, 0);
    const totalSignals = sorted.reduce((sum, [,stats]) => sum + stats.totalSignals, 0);
    console.log(`summary="totals" yield="${totalYield.toFixed(6)}" signals="${totalSignals}"`);
}
