const fs = require('fs');
const path = require('path');

const SUCCESSFUL_DIR = path.join(__dirname, 'jams', 'successful');
const SUCCESSFUL_FILE = path.join(SUCCESSFUL_DIR, 'successful-jams.jsonl');

const JAM_INTERACTIONS_FILE = path.join(__dirname, 'jams', 'interactions.jsonl');
class JAMStore {
    constructor() {
        this.storePath = path.join(__dirname, 'jams');
        this.ensureDirectory();
    }

    ensureDirectory() {
        if (!fs.existsSync(this.storePath)) {
            fs.mkdirSync(this.storePath, { recursive: true });
        }
        if (!fs.existsSync(SUCCESSFUL_DIR)) {
            fs.mkdirSync(SUCCESSFUL_DIR, { recursive: true });
        }
    }
    
    store(hash, jamData) {
        const finalPath = path.join(this.storePath, `${hash}.json`);
        const tempPath = finalPath + '.tmp';
        try {
            fs.writeFileSync(tempPath, JSON.stringify(jamData, null, 2));
            fs.renameSync(tempPath, finalPath);
            console.log(`jam_store_op=\"write\" hash=${hash.slice(0, 10)}`);
        } catch (error) {
            console.error(`jam_store_op=\"write_failed\" hash=${hash.slice(0,10)} error=\"${error.message}\"`);
        }
    }

    retrieve(hash) {
        const filePath = path.join(this.storePath, `${hash}.json`);
        try {
            if (fs.existsSync(filePath)) {
                const data = fs.readFileSync(filePath, 'utf8');
                return JSON.parse(data);
            }
        } catch (error) {
            console.error(`jam_store_op=\"read_failed\" hash=${hash.slice(0,10)} error=\"${error.message}\"`);
        }
        return null;
    }

    update(hash, data) {
        const existing = this.retrieve(hash) || {};
        const updatedData = { ...existing, ...data };
        this.store(hash, updatedData);
        return true;
    }

    saveSuccessfulJAM(signalHash, jam) {
        try {
            const cosmicData = jam.cosmic || {};
            const mevTags = cosmicData.mev_tags || [];
            const compressedJAM = {
                timestamp: Date.now(),
                resonance: jam.resonance || cosmicData.resonance || 1.0,
                intent_class: cosmicData.mev_metadata?.intent_class || 'STANDARD',
                mev_tags: mevTags,
                signalHash: signalHash
            };
            fs.appendFileSync(SUCCESSFUL_FILE, JSON.stringify(compressedJAM) + '\n');
            console.log(`successful_jam_saved=\"${signalHash.slice(0,10)}\"`);
        } catch (e) {
            console.warn('Could not save successful JAM:', e.message);
        }
    }

    getSuccessfulJAMs() {
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
    }

    getSuccessfulJAMsByIntent(intentClass) {
        const allJAMs = this.getSuccessfulJAMs();
        return allJAMs.filter(jam => jam.intent_class === intentClass);
    }

    // --- Reflexive Brain Functions ---

    recordInteraction(jamHash, botAddress, profit) {
        try {
            const interaction = {
                timestamp: Date.now(),
                jamHash,
                botAddress,
                profit
            };
            fs.appendFileSync(JAM_INTERACTIONS_FILE, JSON.stringify(interaction) + '\n');
            console.log(`interaction_recorded jam=${jamHash.slice(0,10)} bot=${botAddress} profit=${profit}`);
        } catch (e) {
            console.warn('Could not record JAM interaction:', e.message);
        }
    }

    getInteractionHistory(jamHash = null) {
        try {
            if (!fs.existsSync(JAM_INTERACTIONS_FILE)) return [];
            const lines = fs.readFileSync(JAM_INTERACTIONS_FILE, 'utf8').split('\n').filter(line => line.trim());
            const interactions = lines.map(line => JSON.parse(line));

            if (jamHash) {
                return interactions.filter(i => i.jamHash === jamHash);
            }
            return interactions;
        } catch (e) {
            console.warn('Could not read JAM interaction history:', e.message);
            return [];
        }
    }
}

module.exports = new JAMStore();
