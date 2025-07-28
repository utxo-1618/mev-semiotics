#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { Octokit } = require('@octokit/rest');
const jamStore = require('../jam-store');

// GitHub configuration
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER || 'your-username';
const GITHUB_REPO = process.env.GITHUB_REPO || 'dss-reflux-feeds';

// Feed paths
const FEEDS_DIR = path.join(__dirname, '..', 'logs', 'feeds');

// Initialize Octokit if token provided
let octokit;
if (GITHUB_TOKEN) {
    octokit = new Octokit({ auth: GITHUB_TOKEN });
}

// Create feed manifest
const createManifest = () => {
    const allJAMs = jamStore.getSuccessfulJAMs();
    const stats = jamStore.getNarrativePerformance();
    
    return {
        oracle: 'dss-reflux-semantic-feed',
        version: '1.0.0',
        updated: Date.now(),
        total_jams: allJAMs.length,
        feeds: {
            latest: 'latest.json',
            divine: 'divine.json',
            moon: 'moon.json',
            all: 'all.json'
        },
        stats: {
            narratives: stats,
            intent_distribution: getIntentDistribution(allJAMs),
            cosmic_alignment: getCosmicStats(allJAMs)
        },
        ipfs: null, // Placeholder for IPFS hash
        github: `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}`
    };
};

// Get intent distribution
const getIntentDistribution = (jams) => {
    const dist = {};
    jams.forEach(jam => {
        dist[jam.intent_class] = (dist[jam.intent_class] || 0) + 1;
    });
    return dist;
};

// Get cosmic statistics
const getCosmicStats = (jams) => {
    const moonPhases = {};
    const mercuryStates = { direct: 0, retrograde: 0 };
    
    jams.forEach(jam => {
        jam.mev_tags.forEach(tag => {
            if (tag.startsWith('MOON:')) {
                const phase = tag.split(':')[1];
                moonPhases[phase] = (moonPhases[phase] || 0) + 1;
            }
            if (tag === 'MERC:retrograde') {
                mercuryStates.retrograde++;
            } else if (tag === 'MERC:direct') {
                mercuryStates.direct++;
            }
        });
    });
    
    return { moonPhases, mercuryStates };
};

// Anchor to GitHub
const anchorToGitHub = async () => {
    if (!octokit) {
        console.log('GitHub token not provided, skipping GitHub anchor');
        return;
    }
    
    try {
        // Create or update manifest
        const manifest = createManifest();
        const manifestContent = JSON.stringify(manifest, null, 2);
        
        // Check if repo exists, create if not
        try {
            await octokit.repos.get({
                owner: GITHUB_OWNER,
                repo: GITHUB_REPO
            });
        } catch (e) {
            if (e.status === 404) {
                console.log('Creating GitHub repository...');
                await octokit.repos.createForAuthenticatedUser({
                    name: GITHUB_REPO,
                    description: 'DSS-Reflux Semantic Feed Oracle - Cosmic JAM signals',
                    private: false
                });
            }
        }
        
        // Update manifest file
        await updateGitHubFile('manifest.json', manifestContent);
        
        // Update feed files
        const feeds = ['latest', 'divine', 'moon'];
        for (const feed of feeds) {
            const feedPath = path.join(FEEDS_DIR, `${feed}.json`);
            if (fs.existsSync(feedPath)) {
                const content = fs.readFileSync(feedPath, 'utf8');
                await updateGitHubFile(`${feed}.json`, content);
            }
        }
        
        // Create README
        const readme = `# DSS-Reflux Semantic Feed Oracle

Cosmic-semantic JAM signals for MEV alpha.

## Feeds

- **latest.json** - Most recent successful JAMs
- **divine.json** - DIVINE_ARBITRAGE high-resonance signals  
- **moon.json** - Lunar phase synchronized signals
- **manifest.json** - Oracle metadata and statistics

## Usage

\`\`\`bash
# Fetch latest signals
curl https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/main/latest.json

# Local API endpoint
curl http://localhost:8585/feed/latest
\`\`\`

## Signal Format

\`\`\`json
{
  "timestamp": 1735307502000,
  "resonance": 1.52,
  "intent_class": "DIVINE_ARBITRAGE",
  "mev_tags": ["MOON:full", "MERC:retrograde"],
  "signalHash": "0x3b8d6123..."
}
\`\`\`

Updated: ${new Date().toISOString()}
`;
        
        await updateGitHubFile('README.md', readme);
        
        console.log(`GitHub anchor complete: https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}`);
        
    } catch (error) {
        console.error('GitHub anchor error:', error.message);
    }
};

// Update GitHub file
const updateGitHubFile = async (filename, content) => {
    try {
        // Check if file exists
        let sha;
        try {
            const { data } = await octokit.repos.getContent({
                owner: GITHUB_OWNER,
                repo: GITHUB_REPO,
                path: filename
            });
            sha = data.sha;
        } catch (e) {
            // File doesn't exist, will create
        }
        
        // Create or update file
        await octokit.repos.createOrUpdateFileContents({
            owner: GITHUB_OWNER,
            repo: GITHUB_REPO,
            path: filename,
            message: `Update ${filename} - ${new Date().toISOString()}`,
            content: Buffer.from(content).toString('base64'),
            sha: sha
        });
        
        console.log(`Updated ${filename}`);
    } catch (error) {
        console.error(`Error updating ${filename}:`, error.message);
    }
};

// Main execution
const main = async () => {
    console.log('=== Feed Anchoring Service ===\n');
    
    // Update local feeds first
    const allJAMs = jamStore.getSuccessfulJAMs();
    console.log(`Total JAMs to anchor: ${allJAMs.length}`);
    
    // Anchor to GitHub
    await anchorToGitHub();
    
    console.log('\nAnchoring complete!');
};

// Run if called directly
if (require.main === module) {
    main().catch(console.error);
}

module.exports = { anchorToGitHub, createManifest };
