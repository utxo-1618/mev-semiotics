#!/usr/bin/env node

const jamStore = require('../jam-store');

// Command line arguments
const args = process.argv.slice(2);
const command = args[0] || 'all';

console.log('=== Successful JAMs Viewer ===\n');

switch(command) {
    case 'all':
        // Show all successful JAMs
        const allJAMs = jamStore.getSuccessfulJAMs();
        console.log(`Total successful JAMs: ${allJAMs.length}\n`);
        
        allJAMs.forEach((jam, index) => {
            console.log(`#${index + 1}:`);
            console.log(`  Timestamp: ${new Date(jam.timestamp).toISOString()}`);
            console.log(`  Resonance: ${jam.resonance}`);
            console.log(`  Intent: ${jam.intent_class}`);
            console.log(`  MEV Tags: ${jam.mev_tags.join(', ')}`);
            console.log(`  Signal: ${jam.signalHash.slice(0, 10)}...\n`);
        });
        break;
        
    case 'divine':
        // Show only DIVINE_ARBITRAGE JAMs
        const divineJAMs = jamStore.getSuccessfulJAMsByIntent('DIVINE_ARBITRAGE');
        console.log(`DIVINE_ARBITRAGE JAMs: ${divineJAMs.length}\n`);
        
        divineJAMs.forEach((jam, index) => {
            console.log(`#${index + 1}: ${jam.signalHash.slice(0, 10)}... | Resonance: ${jam.resonance} | Tags: ${jam.mev_tags.join(', ')}`);
        });
        break;
        
    case 'moon':
        // Show JAMs with moon tags
        const moonJAMs = jamStore.getSuccessfulJAMs().filter(jam => 
            jam.mev_tags.some(tag => tag.includes('MOON:'))
        );
        console.log(`Moon-aligned JAMs: ${moonJAMs.length}\n`);
        
        moonJAMs.forEach((jam, index) => {
            const moonTag = jam.mev_tags.find(tag => tag.includes('MOON:'));
            console.log(`#${index + 1}: ${jam.signalHash.slice(0, 10)}... | ${moonTag} | Intent: ${jam.intent_class}`);
        });
        break;
        
    case 'stats':
        // Show statistics
        const stats = jamStore.getSuccessfulJAMs();
        const intentCounts = {};
        const tagCounts = {};
        let totalResonance = 0;
        
        stats.forEach(jam => {
            // Count intents
            intentCounts[jam.intent_class] = (intentCounts[jam.intent_class] || 0) + 1;
            
            // Count tags
            jam.mev_tags.forEach(tag => {
                const tagType = tag.split(':')[0];
                tagCounts[tagType] = (tagCounts[tagType] || 0) + 1;
            });
            
            totalResonance += jam.resonance;
        });
        
        console.log('Intent Distribution:');
        Object.entries(intentCounts).forEach(([intent, count]) => {
            console.log(`  ${intent}: ${count} (${(count/stats.length*100).toFixed(1)}%)`);
        });
        
        console.log('\nTag Distribution:');
        Object.entries(tagCounts).forEach(([tag, count]) => {
            console.log(`  ${tag}: ${count}`);
        });
        
        console.log(`\nAverage Resonance: ${(totalResonance/stats.length).toFixed(3)}`);
        break;
        
    default:
        console.log('Usage: node view-successful-jams.js [command]');
        console.log('Commands:');
        console.log('  all    - Show all successful JAMs');
        console.log('  divine - Show DIVINE_ARBITRAGE JAMs');
        console.log('  moon   - Show moon-aligned JAMs');
        console.log('  stats  - Show statistics');
}
