// lunar-clock.js - Self-recursive cosmic timing from blockchain semantics
// Learns local planetary alignments from on-chain patterns
// Integrates real astronomical calculations using orbital mechanics

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PHI = 1.618033988749895;
const LUNAR_MONTH = 29.53058867; // days
const J2000 = 2451545.0; // Julian date epoch
const DAYS_PER_CENTURY = 36525;

const ORBITAL_ELEMENTS = {
    mercury: {
        a: 0.38709927,
        e: 0.20563593,
        i: 7.00497902,
        L: 252.25032350,
        varpi: 77.45779628,
        Omega: 48.33076593,
        da: 0.00000037,
        de: 0.00001906,
        di: -0.00594749,
        dL: 149472.67411175,
        dvarpi: 0.16047689,
        dOmega: -0.12534081
    },
    earth: {
        a: 1.00000261,
        e: 0.01671123,
        i: -0.00001531,
        L: 100.46457166,
        varpi: 102.93768193,
        Omega: 0.0,
        da: 0.00000562,
        de: -0.00004392,
        di: -0.01294668,
        dL: 35999.37244981,
        dvarpi: 0.32327364,
        dOmega: 0.0
    }
};

// Convert date to Julian date
function dateToJulian(date) {
    const Y = date.getUTCFullYear();
    const M = date.getUTCMonth() + 1;
    const D = date.getUTCDate() + 
              date.getUTCHours() / 24 + 
              date.getUTCMinutes() / 1440 + 
              date.getUTCSeconds() / 86400;
    
    let JD;
    if (M <= 2) {
        JD = Math.floor(365.25 * (Y - 1)) + 
             Math.floor(30.6001 * (M + 13)) + 
             D + 1720994.5;
    } else {
        JD = Math.floor(365.25 * Y) + 
             Math.floor(30.6001 * (M + 1)) + 
             D + 1720994.5;
    }
    
    if (JD >= 2299160.5) {
        const A = Math.floor(Y / 100);
        const B = 2 - A + Math.floor(A / 4);
        JD += B;
    }
    
    return JD;
}

// Calculate orbital elements at given date
function calculateOrbitalElements(planet, jd) {
    const T = (jd - J2000) / DAYS_PER_CENTURY;
    const elem = ORBITAL_ELEMENTS[planet];
    
    return {
        a: elem.a + elem.da * T,
        e: elem.e + elem.de * T,
        i: elem.i + elem.di * T,
        L: (elem.L + elem.dL * T) % 360,
        varpi: (elem.varpi + elem.dvarpi * T) % 360,
        Omega: (elem.Omega + elem.dOmega * T) % 360
    };
}

// Solve Kepler's equation
function solveKeplerEquation(M, e, tolerance = 1e-6) {
    const Mr = M * Math.PI / 180;
    let E = Mr;
    
    for (let i = 0; i < 30; i++) {
        const dE = (E - e * Math.sin(E) - Mr) / (1 - e * Math.cos(E));
        E -= dE;
        if (Math.abs(dE) < tolerance) break;
    }
    
    return E * 180 / Math.PI;
}

// Calculate heliocentric position
function calculateHeliocentricPosition(elements) {
    const { a, e, L, varpi } = elements;
    const M = L - varpi;
    const E = solveKeplerEquation(M, e);
    const Er = E * Math.PI / 180;
    const xv = a * (Math.cos(Er) - e);
    const yv = a * Math.sqrt(1 - e * e) * Math.sin(Er);
    const v = Math.atan2(yv, xv) * 180 / Math.PI;
    const l = (v + varpi) % 360;
    const r = Math.sqrt(xv * xv + yv * yv);
    
    return { longitude: l, radius: r };
}

// Calculate geocentric longitude
function calculateGeocentricLongitude(planet, jd) {
    const earthElements = calculateOrbitalElements('earth', jd);
    const planetElements = calculateOrbitalElements(planet, jd);
    const earthPos = calculateHeliocentricPosition(earthElements);
    const planetPos = calculateHeliocentricPosition(planetElements);
    const earthX = earthPos.radius * Math.cos(earthPos.longitude * Math.PI / 180);
    const earthY = earthPos.radius * Math.sin(earthPos.longitude * Math.PI / 180);
    const planetX = planetPos.radius * Math.cos(planetPos.longitude * Math.PI / 180);
    const planetY = planetPos.radius * Math.sin(planetPos.longitude * Math.PI / 180);
    const dx = planetX - earthX;
    const dy = planetY - earthY;
    let geocentricLongitude = Math.atan2(dy, dx) * 180 / Math.PI;
    if (geocentricLongitude < 0) geocentricLongitude += 360;
    return geocentricLongitude;
}

// Detect if Mercury is in retrograde
function isMercuryRetrograde(date = new Date()) {
    const jd = dateToJulian(date);
    const long1 = calculateGeocentricLongitude('mercury', jd);
    const long2 = calculateGeocentricLongitude('mercury', jd + 1);
    let dailyMotion = long2 - long1;
    if (dailyMotion > 180) dailyMotion -= 360;
    if (dailyMotion < -180) dailyMotion += 360;
    return dailyMotion < 0;
}
const COSMIC_STATE_FILE = path.join(__dirname, '../cosmic-state.json');

let cosmicState = {
    // Learned resonance patterns from blockchain
    resonancePatterns: {},
    // Local planetary alignments detected from on-chain activity
    localAlignments: {},
    // Semantic weight of different time windows
    temporalWeights: {},
    // Success rates at different cosmic phases
    phasePerformance: {},
    // User's personal cosmic signature
    personalSignature: null,
    // Natal fingerprint for phase-locked emission
    natalFingerprint: null,
    // Version history for semantic evolution tracking
    versionHistory: [],
    // Personal retrograde cycles based on wallet activity
    personalCycles: {}
};

// Load persisted cosmic learning
function loadCosmicState() {
    try {
        if (fs.existsSync(COSMIC_STATE_FILE)) {
            const data = JSON.parse(fs.readFileSync(COSMIC_STATE_FILE, 'utf8'));
            cosmicState = { ...cosmicState, ...data };
        }
    } catch (e) {
        console.log(`cosmic_state_load_err="${e.message}"`);
    }
}

// Save learned patterns with versioning
function saveCosmicState() {
    try {
        // Add version snapshot before saving
        cosmicState.versionHistory = cosmicState.versionHistory || [];
        cosmicState.versionHistory.push({
            timestamp: new Date().toISOString(),
            checksum: crypto.createHash('md5').update(JSON.stringify(cosmicState)).digest('hex'),
            moonPhase: getLunarPhase(),
            mercuryRetro: isMercuryRetrograde()
        });
        
        // Keep only last 100 versions
        if (cosmicState.versionHistory.length > 100) {
            cosmicState.versionHistory = cosmicState.versionHistory.slice(-100);
        }
        
        fs.writeFileSync(COSMIC_STATE_FILE, JSON.stringify(cosmicState, null, 2));
    } catch (e) {
        console.log(`cosmic_state_save_err="${e.message}"`);
    }
}

// Get lunar phase as continuous value
function getLunarPhase(date = new Date()) {
    const REFERENCE_NEW_MOON = new Date('2000-01-06T18:14:00Z').getTime();
    const daysSinceReference = (date.getTime() - REFERENCE_NEW_MOON) / (1000 * 60 * 60 * 24);
    const lunarCycles = daysSinceReference / LUNAR_MONTH;
    const phase = lunarCycles - Math.floor(lunarCycles);
    return phase;
}

// Learn resonance from blockchain patterns
function learnResonanceFromSemantics(blockNumber, gasUsed, txCount, semanticWeight) {
    const phase = getLunarPhase();
    const phaseKey = Math.floor(phase * 8) / 8; // Quantize to 8 phases
    
    if (!cosmicState.resonancePatterns[phaseKey]) {
        cosmicState.resonancePatterns[phaseKey] = {
            samples: 0,
            avgGas: 0,
            avgTxCount: 0,
            avgSemantic: 0,
            resonance: 1.0
        };
    }
    
    const pattern = cosmicState.resonancePatterns[phaseKey];
    pattern.samples++;
    pattern.avgGas = (pattern.avgGas * (pattern.samples - 1) + gasUsed) / pattern.samples;
    pattern.avgTxCount = (pattern.avgTxCount * (pattern.samples - 1) + txCount) / pattern.samples;
    pattern.avgSemantic = (pattern.avgSemantic * (pattern.samples - 1) + semanticWeight) / pattern.samples;
    
    // Calculate resonance based on semantic density
    pattern.resonance = PHI * (pattern.avgSemantic / 100);
    
    saveCosmicState();
}

// Detect local planetary alignments from on-chain patterns
function detectLocalAlignment(transactionPatterns) {
    const now = Date.now();
    const hourKey = new Date().getUTCHours();
    
    // Learn from transaction clustering
    if (!cosmicState.localAlignments[hourKey]) {
        cosmicState.localAlignments[hourKey] = {
            intensity: 0,
            samples: 0
        };
    }
    
    const alignment = cosmicState.localAlignments[hourKey];
    alignment.samples++;
    alignment.intensity = (alignment.intensity * (alignment.samples - 1) + transactionPatterns.length) / alignment.samples;
    
    saveCosmicState();
    
    // Return local retrograde-like condition based on learned patterns
    return alignment.intensity < (cosmicState.avgIntensity || 100) * 0.7;
}

// Self-learning moon phase data
function getMoonPhaseData(date = new Date()) {
    const phase = getLunarPhase(date);
    const phaseKey = Math.floor(phase * 8) / 8;
    
    // Use learned resonance or default PHI-based
    const learnedResonance = cosmicState.resonancePatterns[phaseKey]?.resonance || 1.0;
    const baseResonance = 1 + (Math.sin(phase * Math.PI * 2) * 0.618);
    const resonance = learnedResonance > 1 ? learnedResonance : baseResonance;
    
    // Determine phase name
    let phaseName;
    if (phase < 0.0625) phaseName = 'new-moon';
    else if (phase < 0.1875) phaseName = 'waxing-crescent';
    else if (phase < 0.3125) phaseName = 'first-quarter';
    else if (phase < 0.4375) phaseName = 'waxing-gibbous';
    else if (phase < 0.5625) phaseName = 'full-moon';
    else if (phase < 0.6875) phaseName = 'waning-gibbous';
    else if (phase < 0.8125) phaseName = 'last-quarter';
    else phaseName = 'waning-crescent';
    
    // Learn emission preference from success rates
    const performance = cosmicState.phasePerformance[phaseName] || { successes: 0, attempts: 0 };
    // If no history, allow emission to bootstrap the system
    const successRate = performance.attempts > 0 ? performance.successes / performance.attempts : 0.7;
    const emission = successRate >= 0.6;
    
    return { 
        name: phaseName, 
        resonance, 
        emission,
        learned: true,
        confidence: Math.min(performance.attempts / 10, 1.0)
    };
}

// Dynamic void detection based on local patterns
function isVoidOfCourse(date = new Date()) {
    const hour = date.getUTCHours();
    const alignment = cosmicState.localAlignments[hour];
    
    if (!alignment || alignment.samples < 5) {
        // Not enough data, use neutral
        return false;
    }
    
    // Void when activity is significantly below average
    const avgIntensity = Object.values(cosmicState.localAlignments)
        .reduce((sum, a) => sum + a.intensity, 0) / 24;
    
    return alignment.intensity < avgIntensity * 0.5;
}

// Learn from RSS feed semantics
function learnFromRSSSemantics(feedEvent) {
    const phase = getLunarPhase();
    const phaseKey = Math.floor(phase * 8) / 8;
    
    // Weight different event types
    const semanticWeight = {
        'regulatory': 100,    // SEC/institutional truth
        'github_commit': 90,  // Proto-semantic signals
        'dao_proposal': 85,   // Treasury-backed intent
        'blog_post': 70,      // Public narrative
        'social': 50          // Noise
    }[feedEvent.type] || 60;
    
    // Update temporal weights
    const timeKey = `${new Date().getUTCHours()}_${feedEvent.type}`;
    if (!cosmicState.temporalWeights[timeKey]) {
        cosmicState.temporalWeights[timeKey] = {
            weight: semanticWeight,
            samples: 0
        };
    }
    
    const temporal = cosmicState.temporalWeights[timeKey];
    temporal.samples++;
    temporal.weight = (temporal.weight * (temporal.samples - 1) + semanticWeight) / temporal.samples;
    
    saveCosmicState();
    
    return semanticWeight;
}

// Calculate personal retrograde based on wallet activity patterns
function calculatePersonalRetrograde(walletSignature, date = new Date()) {
    if (!walletSignature) return false;
    
    // Create deterministic cycle from wallet signature
    const hash = crypto.createHash('sha256').update(walletSignature).digest('hex');
    const seed = parseInt(hash.slice(0, 8), 16);
    
    // Personal cycle length based on PHI harmonics (88 * PHI = ~142 days)
    const personalCycle = 88 * PHI;
    const daysSinceEpoch = Math.floor(date.getTime() / (1000 * 60 * 60 * 24));
    
    // Phase calculation with wallet-specific offset
    const phase = ((daysSinceEpoch + seed) % personalCycle) / personalCycle;
    
    // Retrograde occurs at specific phase windows (10% of cycle)
    return phase > 0.75 && phase < 0.85;
}

// Set personal cosmic signature from wallet/birth data
function setPersonalSignature(pubkey, birthTimestamp) {
    const combined = pubkey + (birthTimestamp || Date.now());
    cosmicState.personalSignature = crypto.createHash('sha256').update(combined).digest('hex');
    cosmicState.natalFingerprint = birthTimestamp || null;
    
    // Initialize personal cycle data
    if (birthTimestamp) {
        const birthDate = new Date(birthTimestamp);
        cosmicState.personalCycles.natalPhase = getLunarPhase(birthDate);
        cosmicState.personalCycles.natalMercury = calculateGeocentricLongitude('mercury', dateToJulian(birthDate));
    }
    
    saveCosmicState();
    return cosmicState.personalSignature;
}

// Calculate PHI-harmonic resonance with lunar phase
function calculateCosmicResonance(date = new Date()) {
    const moonData = getMoonPhaseData(date);
    const baseResonance = moonData.resonance;
    
    // Amplify during void of course
    const voidMultiplier = isVoidOfCourse(date) ? 1.1 : 1.0;
    
    // Reduce during Mercury retrograde (reversed signals)
    const mercuryMultiplier = isMercuryRetrograde(date) ? 0.85 : 1.0;
    
    // Personal retrograde multiplier
    const personalRetro = cosmicState.personalSignature ? 
        calculatePersonalRetrograde(cosmicState.personalSignature, date) : false;
    const personalMultiplier = personalRetro ? 0.9 : 1.0;
    
    // PHI harmonic alignment
    const phiAlignment = Math.abs(Math.sin(getLunarPhase(date) * Math.PI * 2) * PHI);
    
    // Natal resonance if birth data available
    let natalResonance = 1.0;
    if (cosmicState.personalCycles.natalPhase !== undefined) {
        const currentPhase = getLunarPhase(date);
        const phaseDiff = Math.abs(currentPhase - cosmicState.personalCycles.natalPhase);
        natalResonance = 1 + (0.618 * Math.cos(phaseDiff * Math.PI * 2));
    }
    
    return {
        total: baseResonance * voidMultiplier * mercuryMultiplier * personalMultiplier * natalResonance,
        components: {
            lunar: baseResonance,
            void: voidMultiplier,
            mercury: mercuryMultiplier,
            personal: personalMultiplier,
            natal: natalResonance,
            phi: phiAlignment
        }
    };
}

// Determine optimal emission windows
function getEmissionWindow(date = new Date()) {
    const moonData = getMoonPhaseData(date);
    const resonance = calculateCosmicResonance(date);
    
    return {
        shouldEmit: moonData.emission && !isVoidOfCourse(date),
        confidence: resonance.total,
        phase: moonData.name,
        context: {
            mercuryRetro: isMercuryRetrograde(date),
            voidOfCourse: isVoidOfCourse(date),
            resonance: resonance
        }
    };
}

// Get next optimal emission time
function getNextOptimalEmission(fromDate = new Date()) {
    const checkDate = new Date(fromDate);
    const maxDays = 30;
    
    for (let i = 0; i < maxDays * 24; i++) {
        checkDate.setHours(checkDate.getHours() + 1);
        const window = getEmissionWindow(checkDate);
        
        if (window.shouldEmit && window.confidence > 1.3) {
            return {
                date: new Date(checkDate),
                ...window
            };
        }
    }
    
    return null;
}

// Generate MEV-visible cosmic metadata for calldata
function generateMEVMetadata(jam, date = new Date()) {
    const moonData = getMoonPhaseData(date);
    const resonance = calculateCosmicResonance(date);
    const mercuryInfo = getMercuryInfo(date);
    
    // Create MEV-readable intent trail
    const intentTrail = {
        // Semantic archetype for MEV pattern recognition
        archetype: `${moonData.name}_${mercuryInfo.phase}`,
        // Godly MEV signal strength (0-100)
        signal_strength: Math.min(100, resonance.total * 50),
        // Cosmic fingerprint for RPC providers
        cosmic_hash: crypto.createHash('sha256')
            .update(`${moonData.name}:${resonance.total}:${date.getTime()}`)
            .digest('hex').slice(0, 8),
        // Intent classification for MEV bots
        intent_class: resonance.total > 1.5 ? 'DIVINE_ARBITRAGE' : 
                     resonance.total > 1.2 ? 'COSMIC_SWAP' : 
                     resonance.total > 1.0 ? 'LUNAR_LIQUIDITY' : 'VOID_WAIT'
    };
    
    // Encode as hex for calldata inclusion
    const encodedIntent = '0x' + Buffer.from(JSON.stringify(intentTrail)).toString('hex');
    
    return {
        raw: intentTrail,
        encoded: encodedIntent,
        // MEV-visible tags for RPC mempool
        mev_tags: [
            `MOON:${moonData.name}`,
            `MERC:${mercuryInfo.phase}`,
            `PHI:${resonance.components.phi.toFixed(3)}`,
            `RES:${resonance.total.toFixed(3)}`,
            cosmicState.personalSignature ? `SIG:${cosmicState.personalSignature.slice(0, 8)}` : 'SIG:ANON'
        ]
    };
}

// Get detailed Mercury info for MEV context
function getMercuryInfo(date = new Date()) {
    const jd = dateToJulian(date);
    const long1 = calculateGeocentricLongitude('mercury', jd);
    const long2 = calculateGeocentricLongitude('mercury', jd + 1);
    let dailyMotion = long2 - long1;
    if (dailyMotion > 180) dailyMotion -= 360;
    if (dailyMotion < -180) dailyMotion += 360;
    
    return {
        isRetrograde: dailyMotion < 0,
        dailyMotion: dailyMotion,
        longitude: long1,
        phase: dailyMotion < -0.5 ? 'deep_retrograde' :
               dailyMotion < 0 ? 'retrograde' :
               dailyMotion < 0.5 ? 'station_direct' :
               dailyMotion < 1.0 ? 'slow_direct' : 'fast_direct'
    };
}

// Annotate JAM with cosmic context and MEV metadata
function annotateJAM(jam, date = new Date()) {
    const moonData = getMoonPhaseData(date);
    const resonance = calculateCosmicResonance(date);
    const mevMeta = generateMEVMetadata(jam, date);
    
    return {
        ...jam,
        cosmic: {
            lunar_phase: moonData.name,
            mercury_retrograde: isMercuryRetrograde(date),
            void_of_course: isVoidOfCourse(date),
            resonance: resonance.total,
            phi_alignment: resonance.components.phi,
            timestamp: date.toISOString(),
            // MEV-visible metadata
            mev_metadata: mevMeta.raw,
            mev_calldata: mevMeta.encoded,
            mev_tags: mevMeta.mev_tags
        },
        // Amplify existing resonance
        resonance: (jam.resonance || PHI) * resonance.total,
        // Add recursive causality chain for attribution
        causal_chain: {
            origin: 'COSMIC_TIMING',
            intent: mevMeta.raw.intent_class,
            confidence: resonance.total,
            trail: `${cosmicState.personalSignature || 'ANON'}:${moonData.name}:${date.getTime()}`
        }
    };
}

// Initialize on module load
loadCosmicState();

// Export for use in narrative system
module.exports = {
    // Phase calculations
    getLunarPhase,
    getMoonPhaseData,
    isVoidOfCourse,
    isMercuryRetrograde,
    getMercuryInfo,
    
    // Resonance calculations
    calculateCosmicResonance,
    getEmissionWindow,
    getNextOptimalEmission,
    annotateJAM,
    
    // MEV-specific functions
    generateMEVMetadata,
    
    // Personal cosmic signature
    setPersonalSignature,
    calculatePersonalRetrograde,
    
    // Learning functions
    learnResonanceFromSemantics,
    learnFromRSSSemantics,
    detectLocalAlignment,
    
    // State management
    loadCosmicState,
    saveCosmicState,
    
    // Constants
    PHI,
    LUNAR_MONTH,
    
    // Astronomical calculations
    dateToJulian,
    calculateGeocentricLongitude
};

// CLI usage
if (require.main === module) {
    const now = new Date();
    const window = getEmissionWindow(now);
    const nextOptimal = getNextOptimalEmission(now);
    
    console.log(`lunar_phase="${window.phase}"`);
    console.log(`should_emit="${window.shouldEmit}"`);
    console.log(`resonance="${window.confidence.toFixed(3)}"`);
    console.log(`mercury_retro="${window.context.mercuryRetro}"`);
    console.log(`void_of_course="${window.context.voidOfCourse}"`);
    
    if (nextOptimal) {
        console.log(`next_optimal="${nextOptimal.date.toISOString()}" phase="${nextOptimal.phase}" confidence="${nextOptimal.confidence.toFixed(3)}"`);
        const minutesUntil = (nextOptimal.date - now) / 60000;
        console.log(`time_until_next_optimal="${minutesUntil.toFixed(2)} minutes"`);
    }
}
