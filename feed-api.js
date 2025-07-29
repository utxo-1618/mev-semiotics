#!/usr/bin/env node

const express = require('express');
const fs = require('fs');
const path = require('path');
const jamStore = require('./jam-store');

const app = express();
const PORT = process.env.FEED_PORT || 8585;

// Feed paths
const FEEDS_DIR = path.join(__dirname, 'logs', 'feeds');
const LATEST_FEED = path.join(FEEDS_DIR, 'latest.json');
const DIVINE_FEED = path.join(FEEDS_DIR, 'divine.json');
const MOON_FEED = path.join(FEEDS_DIR, 'moon.json');

// Ensure feeds directory exists
if (!fs.existsSync(FEEDS_DIR)) {
    fs.mkdirSync(FEEDS_DIR, { recursive: true });
}

// Update feeds every minute
const updateFeeds = () => {
    const allJAMs = jamStore.getSuccessfulJAMs();
    
    // Latest feed - last 10 successful JAMs
    const latest = allJAMs.slice(-10).reverse();
    fs.writeFileSync(LATEST_FEED, JSON.stringify({
        updated: Date.now(),
        count: latest.length,
        jams: latest
    }, null, 2));
    
    // Divine arbitrage feed
    const divine = jamStore.getSuccessfulJAMsByIntent('DIVINE_ARBITRAGE');
    fs.writeFileSync(DIVINE_FEED, JSON.stringify({
        updated: Date.now(),
        count: divine.length,
        jams: divine
    }, null, 2));
    
    // Moon-aligned feed
    const moon = allJAMs.filter(jam => 
        jam.mev_tags.some(tag => tag.includes('MOON:'))
    );
    fs.writeFileSync(MOON_FEED, JSON.stringify({
        updated: Date.now(),
        count: moon.length,
        jams: moon
    }, null, 2));
    
    console.log(`feeds_updated count="${allJAMs.length}" divine="${divine.length}" moon="${moon.length}"`);
};

// Initial update
updateFeeds();
setInterval(updateFeeds, 60000);

// API Routes

// Root - oracle info
app.get('/', (req, res) => {
    const allJAMs = jamStore.getSuccessfulJAMs();
    res.json({
        oracle: 'semantic-feed',
        version: '1.0.0',
        description: 'JAM signals oracle',
        total_jams: allJAMs.length,
        feeds: {
            latest: '/feed/latest',
            divine: '/feed/divine',
            moon: '/feed/moon',
            all: '/feed/all',
            stats: '/stats',
            'latest-jam': '/latest-jam.json'
        }
    });
});

// Latest successful JAMs
app.get('/feed/latest', (req, res) => {
    const limit = parseInt(req.query.limit) || 10;
    const allJAMs = jamStore.getSuccessfulJAMs();
    const latest = allJAMs.slice(-limit).reverse();
    
    res.json({
        timestamp: Date.now(),
        count: latest.length,
        jams: latest
    });
});

// All successful JAMs
app.get('/feed/all', (req, res) => {
    const allJAMs = jamStore.getSuccessfulJAMs();
    res.json({
        timestamp: Date.now(),
        count: allJAMs.length,
        jams: allJAMs
    });
});

// Divine arbitrage feed
app.get('/feed/divine', (req, res) => {
    const divine = jamStore.getSuccessfulJAMsByIntent('DIVINE_ARBITRAGE');
    res.json({
        timestamp: Date.now(),
        intent: 'DIVINE_ARBITRAGE',
        description: 'High-resonance cosmic arbitrage signals',
        count: divine.length,
        jams: divine
    });
});

// Moon-aligned feed
app.get('/feed/moon', (req, res) => {
    const allJAMs = jamStore.getSuccessfulJAMs();
    const moon = allJAMs.filter(jam => 
        jam.mev_tags.some(tag => tag.includes('MOON:'))
    );
    
    res.json({
        timestamp: Date.now(),
        filter: 'moon-aligned',
        description: 'Lunar phase synchronized signals',
        count: moon.length,
        jams: moon
    });
});

// Statistics endpoint
app.get('/stats', (req, res) => {
    const allJAMs = jamStore.getSuccessfulJAMs();
    const intentCounts = {};
    const tagCounts = {};
    let totalResonance = 0;
    
    allJAMs.forEach(jam => {
        intentCounts[jam.intent_class] = (intentCounts[jam.intent_class] || 0) + 1;
        jam.mev_tags.forEach(tag => {
            const tagType = tag.split(':')[0];
            tagCounts[tagType] = (tagCounts[tagType] || 0) + 1;
        });
        totalResonance += jam.resonance;
    });
    
    res.json({
        timestamp: Date.now(),
        total_jams: allJAMs.length,
        average_resonance: allJAMs.length > 0 ? (totalResonance / allJAMs.length).toFixed(3) : 0,
        intent_distribution: intentCounts,
        tag_distribution: tagCounts
    });
});

// Latest JAM file - instant, no caching (perfect for MEV)
app.get('/latest-jam.json', (req, res) => {
    const jamFilePath = path.join(__dirname, 'latest-jam.json');
    
    // Set headers to prevent caching
    res.set({
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
        'Content-Type': 'application/json'
    });
    
    try {
        if (!fs.existsSync(jamFilePath)) {
            return res.status(404).json({ error: 'Latest JAM not found' });
        }
        
        const jamContent = fs.readFileSync(jamFilePath, 'utf8');
        const jamData = JSON.parse(jamContent);
        
        res.json(jamData);
    } catch (error) {
        console.error(`latest_jam_serve_err="${error.message}"`);
        res.status(500).json({ error: 'Failed to read latest JAM' });
    }
});

// Single JAM by signalHash
app.get('/jam/:hash', (req, res) => {
    const hash = req.params.hash;
    const allJAMs = jamStore.getSuccessfulJAMs();
    const jam = allJAMs.find(j => j.signalHash.startsWith(hash));
    
    if (!jam) {
        return res.status(404).json({ error: 'JAM not found' });
    }
    
    res.json(jam);
});

// Start server
app.listen(PORT, () => {
    console.log(`feed_api="started" port="${PORT}" feeds="/logs/feeds/"`);
    console.log('endpoints="/,/feed/latest,/feed/all,/feed/divine,/feed/moon,/stats,/jam/:hash"');
});
