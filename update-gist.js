// Gist Auto-Updater
// Maintains alignment between local JAMs and public signal compass
const fs = require('fs');
const path = require('path');
const https = require('https');
require('dotenv').config();

// --- Configuration ---
const GIST_ID = process.env.GIST_ID;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const DEBOUNCE_DELAY = 120000; // 2 minutes
const MAX_RETRIES = 2; // Reduce retries
const RETRY_DELAY = 30000; // 30 seconds
const MIN_UPDATE_INTERVAL = 600000; // 10 minutes - robust protection against rate-limiting

// --- Validation ---
if (!GIST_ID || !GITHUB_TOKEN) {
    console.error('env_error=missing_vars vars="GIST_ID,GITHUB_TOKEN"');
    process.exit(1);
}
const authHeader = `token ${GITHUB_TOKEN}`;

// --- State ---
let isUpdating = false;
let debounceTimeout = null;
let lastUpdateTime = 0;

// --- Utility Functions ---
const log = (level, message, error = null) => {
    console.log(`${level.toLowerCase()}="${message}"` + (error ? ` error="${error.message}"` : ''));
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// --- Core Logic ---
async function updateGist() {
    if (isUpdating) {
        log('info', 'update_skip="already_in_progress"');
        return;
    }
    
    // Check if enough time has passed since last update
    const timeSinceLastUpdate = Date.now() - lastUpdateTime;
    if (timeSinceLastUpdate < MIN_UPDATE_INTERVAL) {
        const remainingTime = Math.ceil((MIN_UPDATE_INTERVAL - timeSinceLastUpdate) / 1000);
        log('info', `rate_limit_protection="active" remaining="${remainingTime}s"`);
        return;
    }
    
    isUpdating = true;
    log('info', 'gist_update="starting"');

    const jamFilePath = path.join(__dirname, 'latest-jam.json');

    try {
        // 1. Check for file existence and readability
        try {
            await fs.promises.access(jamFilePath, fs.constants.R_OK);
        } catch (err) {
            log('info', `jam_update=skip reason="file_not_accessible"`);
            return;
        }
        
        // 2. Read file content
        const jamContent = await fs.promises.readFile(jamFilePath, 'utf8');
        if (!jamContent.trim()) {
            log('info', 'jam_update=skip reason="file_empty"');
            return;
        }

        // 3. Validate JSON
        try {
            JSON.parse(jamContent);
        } catch (err) {
            log('info', 'jam_update=skip reason="invalid_json"');
            return;
        }
        
        // 4. Prepare and make Gist API request
        const options = {
            hostname: 'api.github.com',
            path: `/gists/${GIST_ID}`,
            method: 'PATCH',
headers: { 'User-Agent': 'Gist-Updater', 'Content-Type': 'application/json', 'Authorization': authHeader, 'Accept': 'application/vnd.github.v3+json' }
        };
        const data = JSON.stringify({ files: { 'latest-jam.json': { content: jamContent } } });

        for (let i = 0; i < MAX_RETRIES; i++) {
            try {
                await new Promise((resolve, reject) => {
                    const req = https.request(options, res => {
                        let body = '';
                        res.on('data', chunk => body += chunk);
                        res.on('end', () => {
                            if (res.statusCode === 200) {
                                log('info', 'compass=aligned" phi="1.618" recursive="true');
                                lastUpdateTime = Date.now();
                                resolve();
                            } else if (res.statusCode === 403 && body.includes('rate limit')) {
                                // Handle rate limit specifically
                                log('warn', 'github_api=rate_limited retry=later');
                                lastUpdateTime = Date.now(); // Prevent immediate retries
                                reject(new Error(`Rate limit exceeded`));
                            } else {
                                reject(new Error(`API Error: ${res.statusCode} - ${body}`));
                            }
                        });
                    });
                    req.on('error', reject);
                    req.write(data);
                    req.end();
                });
                return; // Success, exit the retry loop
            } catch (err) {
            log('warn', `gist_update=fail attempt=${i + 1} max=${MAX_RETRIES}`);
                if (i === MAX_RETRIES - 1) {
                    throw err; // Rethrow last error
                }
                await sleep(RETRY_DELAY);
            }
        }
    } catch (error) {
        log('error', `gist_update=error msg="${error.message}"`);
    } finally {
        isUpdating = false;
        log('info', 'gist_update=complete');
    }
}

// --- Main Execution ---
let isRunning = false;
function main() {
    if (isRunning) return;
    isRunning = true;
    const jamFilePath = path.join(__dirname, 'latest-jam.json');

    // Ensure the file exists
    if (!fs.existsSync(jamFilePath)) {
        log('info', 'jam_file=created state=empty');
        fs.writeFileSync(jamFilePath, '{}\n');
    }

// Trigger update on file change (with debounce)
    let debounceTimeout = null;
    let updateQueue = [];
    
    fs.watch(jamFilePath, (eventType, filename) => {
        if (eventType === 'change') {
            if (debounceTimeout) {
                clearTimeout(debounceTimeout);
            }
            
            const now = Date.now();
            updateQueue.push(now);
            
            // Remove old entries from queue (older than 1 hour)
            updateQueue = updateQueue.filter(time => now - time < 3600000);
            
            // If too many updates in recent time, skip
            if (updateQueue.length > 10) {
                log('warn', 'update_skip="too_many_recent" queue_size="10+"');
                return;
            }
            
            log('info', 'jam_change=detected state=debouncing');
            debounceTimeout = setTimeout(() => {
                log('info', 'debounce=complete action=update');
                updateGist();
            }, DEBOUNCE_DELAY);
        }
    });

    // Initial update
    log('info', 'gist_update=init');
    updateGist();

    console.log('state=ready compass=active phi="1.618"');
}

main();
