#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const jamStore = require('./jam-store');

const PHI = 1.618033988749895;

// Read attributions
const logPath = path.join(__dirname, 'logs', 'attributions.jsonl');
let attrs = [];
let yieldMap = new Map();
let total = 0;

if (fs.existsSync(logPath)) {
    fs.readFileSync(logPath, 'utf8').split('\n').filter(l => l).forEach(line => {
        const a = JSON.parse(line);
        attrs.push(a);
        total += parseFloat(a.yieldAmount);
        yieldMap.set(a.signalHash, (yieldMap.get(a.signalHash) || 0) + parseFloat(a.yieldAmount));
    });
}

// Get high yield jams
const highYield = jamStore.getHighYieldJams();

// Output
console.log(`total_yield="${total.toFixed(6)}" attributions="${attrs.length}" signals="${yieldMap.size}"`);

// Top signals
const top = Array.from(yieldMap.entries()).sort((a,b) => b[1] - a[1]).slice(0,3);
top.forEach(([hash, yield]) => {
    const jam = jamStore.retrieve(hash);
    console.log(`top_signal="${hash.slice(0,10)}" yield="${yield.toFixed(6)}" depth="${jam?.cascadeDepth || 1}" strength="${(jam?.causalStrength || 1).toFixed(3)}"`);
});

// High yield count
console.log(`high_yield_jams="${highYield.length}"`);

// Recent
if (attrs.length > 0) {
    const recent = attrs[attrs.length - 1];
    console.log(`last_attribution="${recent.signalHash.slice(0,10)}" bot="${recent.frontrunner.slice(0,10)}" yield="${recent.yieldAmount}" similarity="${recent.similarity}"`);
}

// PHI alignment
let phiAligned = attrs.filter(a => {
    const v = parseFloat(a.yieldAmount);
    return [PHI, 1/PHI, PHI*PHI, Math.sqrt(PHI)].some(r => {
        const d = Math.abs(v % r);
        return d < 0.001 || d > (r - 0.001);
    });
}).length;

console.log(`phi_aligned="${phiAligned}/${attrs.length}" ratio="${(phiAligned/attrs.length).toFixed(3)}"`);

// Causality
if (highYield.length > 0) {
    const best = highYield[0];
    console.log(`best_causality="${best.hash.slice(0,10)}" score="${best.score.toFixed(3)}"`);
}
