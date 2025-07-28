const fs = require('fs');
const path = require('path');

const STATE_FILE_PATH = path.join(__dirname, 'system-state.json');
const { PROVERB_PATTERNS } = require('./constants');

// Initialize the default structure of the system state.
const getDefaultState = () => ({
    lastHash: null,
    metrics: {
        totalAnalyses: 0,
        auditPasses: 0,
        auditFails: 0,
        emissionSuccesses: 0,
        emissionFailures: 0,
        lastAuditFailReason: null,
        patternSuccess: Object.keys(PROVERB_PATTERNS).reduce((acc, pattern) => {
            acc[pattern] = { attempts: 0, successes: 0, lastUsed: 0 };
            return acc;
        }, {})
    },
    isEmittingLock: {
        isLocked: false,
        pid: null,
        timestamp: null
    }
});

let systemState = getDefaultState();

// Atomically saves the current state to disk.
function saveSystemState() {
    const tempPath = STATE_FILE_PATH + '.tmp';
    try {
        fs.writeFileSync(tempPath, JSON.stringify(systemState, null, 2));
        fs.renameSync(tempPath, STATE_FILE_PATH);
    } catch (error) {
        console.error(`state=error action=save error=${error}`);
        process.exit(1);
    }
}

// Loads the system state from disk, handling stale locks and corrupted files.
function loadSystemState() {
    try {
        if (fs.existsSync(STATE_FILE_PATH)) {
            const stateData = fs.readFileSync(STATE_FILE_PATH, 'utf8');
            const persistedState = JSON.parse(stateData);
            
            systemState = { ...getDefaultState(), ...persistedState };

            const lock = systemState.isEmittingLock;
            const STALE_LOCK_TIMEOUT = 5 * 60 * 1000; // 5 minutes

            if (lock && lock.isLocked && (Date.now() - lock.timestamp > STALE_LOCK_TIMEOUT)) {
                console.warn(`state=warn action=clear_lock pid=${lock.pid}`);
                unlock();
            }
        } else {
            // If no state file exists, save the default initial state.
            saveSystemState();
        }
    } catch (error) {
        console.error(`state=error action=load reset=true error=${error}`);
        systemState = getDefaultState();
        saveSystemState();
    }
}

// Safely acquires the emission lock.
function lock() {
    if (systemState.isEmittingLock.isLocked) {
        console.warn(`state=warn action=lock status=held pid=${systemState.isEmittingLock.pid}`);
        return false;
    }
    systemState.isEmittingLock = { isLocked: true, pid: process.pid, timestamp: Date.now() };
    saveSystemState();
    return true;
}

// Releases the emission lock.
function unlock() {
    systemState.isEmittingLock = { isLocked: false, pid: null, timestamp: null };
    saveSystemState();
}

// Provides read-only access to the current state.
const getState = () => (systemState);

// Updates a specific part of the state and persists it.
const updateState = (updater) => {
    updater(systemState);
    saveSystemState();
};

// Initial load on module initialization.
loadSystemState();

module.exports = {
    getState,
    updateState,
    lock,
    unlock
};
