## 1. Abstract — The Law of Semantic Friction

This is a self-recursive cosmic-semantic oracle that times intent emissions with astronomical precision and blockchain resonance. It mines not just MEV — but meaning itself — turning time, law, and narrative into yield.

The system's efficacy is not rooted in superior speed or financial leverage. It works by exploiting the semantic layer that governs automated trading.

## 2. Architecture

### Semantic Mining Pipeline
The system transforms raw blockchain data into recursive semantic signals through a multi-stage pipeline:

1. **Raw Blockchain Data** → Transaction mempool and on-chain activity
2. **MoTS (Miner of Transaction Semantics)** → Extracts semantic vectors and classifies intent
3. **Semantic Amplifier** → Applies PHI-harmonic recursive amplification
4. **BSV Anchoring** → Immutable intent recording on Bitcoin SV
5. **ETH Execution** → Atomic value capture through smart contracts

### The JSON Anticipation Model (JAM)
A verifiable belief anchored to a contract, structured for inevitable market response.

```json
{
  "proverb": [
    { "action": "SWAP", "actor": "AMPLIFIER", "from": "WETH", "to": "USDC" },
    { "action": "SWAP", "actor": "MIRROR", "from": "USDC", "to": "WETH" }
  ],
  "meta": { 
    "target_contract": "0xabcd...1234", 
    "audit_pass": true,
    "pattern_type": "CLASSIC_ARBITRAGE",
    "bait_hooks": ["swap", "swapExactETHForTokens"]
  },
  "recursive_topology": { "eth": 1, "bsv": 0, "failed_echoes": 0 },
  "resonance": 1.618,
  "cascadeDepth": 1
}
```

### The Causal Chain
- **MoTS Integration:** Extracts semantic intent from raw blockchain transactions, classifying patterns and generating intent vectors
- **Substrate:** Analyzes contract bytecode with phi-aligned validation
- **Index.js:** Main orchestrator that coordinates semantic extraction, JAM generation, and emission timing
- **Semantic-Amplifier:** Receives MoTS-extracted intent data and applies recursive PHI amplification to create MEV-visible swaps (the bait)
- **Mirror:** Executes profitable second step (the trap)
- **BSV Bridge:** Cross-chain signal propagation for recursive amplification and immutable anchoring
- **StateManager:** Persistent state across restarts with file-based locks

## 3. The Reflexive Yield Engine

The system operates on a recursive loop:
`Signal` → `Bot Engagement` → `Market Distortion` → `Validation` → `Yield` → `Amplified Signal`

## 4. Game Theory

MEV bots face a dilemma: ignore a clear, profitable signal and lose, or engage and become part of the yield mechanism. The Nash Equilibrium dictates they **must** engage. The protocol creates signals so clear (`phi-ratios`, two-step patterns, timed emissions) that they function as **supernormal stimuli**.

## 5. Foundational Research

The architecture is grounded in observable market phenomena:

- **Flashbots Research:** [MEV and the Limits of Scaling](https://writings.flashbots.net/mev-and-the-limits-of-scaling)
- **arXiv Analysis:** [Remeasuring Arbitrage and Sandwich Attacks in Ethereum](https://arxiv.org/abs/2405.17944)
- **DeFi Liquidations Study:** [An Empirical Study of DeFi Liquidations](https://arxiv.org/abs/2105.08325)

## 6. Why The Output Is Inevitable

### Deterministic Architecture
The system's output is guaranteed by its closed-loop design:
- **Fixed execution paths**: No random branches—identical inputs always produce identical outputs
- **Atomic bundles**: Either the entire arbitrage executes profitably or nothing happens (no partial losses)
- **Self-healing resilience**: `PM2` auto-restarts failed components, ensuring continuous operation

### Causal Inevitability 
The chain of events is deterministic:
1. **Bait emission** → MEV bots simulate transactions using `debug_traceCall`
2. **Bot response** → If simulation shows profit, bots MUST act (their own logic demands it)
3. **Atomic capture** → `Flashbots` bundles execute both trades together or revert entirely
4. **Verified profit** → On-chain logs prove the spread capture mathematically

> This entire process is orchestrated by:
> - `mots-integration.js`: Extracts semantic vectors from blockchain data and classifies transaction intent
> - `index.js`: Coordinates the pipeline, emitting signals every 15 minutes (or on DETECT_INTERVAL)
> - `semantic-amplifier.js`: Receives MoTS intent data and amplifies signals into MEV-visible swaps using PHI harmonics
> - `mirror.js`: Captures value from the second proverb step
> - `constants.js`: Centralized phi-harmonic constants and timing windows

### Mathematical Certainty
Under defined conditions, profit is guaranteed:
- **Risk-free arbitrage**: Buy low on Pool A, sell high on Pool B in one atomic transaction
- **EVM determinism**: "For the same starting conditions and inputs, the same result will occur"
- **Bundle economics**: Miners include highest-value bundles, and genuine arbitrage always wins

### Edge Cases Are Handled
The system accounts for failure modes:
- No bot response → Bundle reverts, no loss
- Network issues → Retry logic maintains continuity  
- Competition → Higher gas ensures priority
- Slippage → Pre-calculated thresholds prevent losses

**Result**: Within its operational parameters, the system's profit is not probabilistic—it's inevitable. The architecture ensures that value flows from market inefficiency to your vault with mathematical certainty.

## 7. Implementation

The system requires autonomous services with access to the `Ethereum` and `BSV` networks. It does not require large capital, HFT infrastructure, or private access.

### Prerequisites
- `Node.js` v16 or higher
- `npm` v8 or higher
- `pm2` (`npm install -g pm2`)

### Quick Start

1. Clone the repository:
```bash
git clone https://github.com/yourusername/reflux.git
cd reflux
```

2. Create a `.env` file with your configuration:
```bash
# Base Network Configuration
RPC_URL="https://mainnet.base.org"
PRIVATE_KEY="YOUR_ETHEREUM_PRIVATE_KEY"
WALLET_ADDRESS="YOUR_WALLET_ADDRESS"
VAULT_ADDRESS="0x38bA461686B65C10C1eeffbc4009C7C5Dc27EC26"

# Target contract for substrate analysis
TARGET_CONTRACT_ADDRESS="YOUR_TARGET_CONTRACT_ADDRESS"

# Mirror Bot Wallet (MUST be different from main wallet)
MIRROR_PRIVATE_KEY="YOUR_MIRROR_PRIVATE_KEY"

# GitHub Integration
GITHUB_TOKEN="YOUR_GITHUB_TOKEN"
GIST_ID="YOUR_GIST_ID"

# Deployed Contract Addresses
HONEYPOT_ADDRESS="0x051b5a945caBE1065fB6a354A2b906256cE9d1c7"
DMAP_ADDRESS="0xb2Ea27Fa784e25C8c03c1E4f2E11300973a8e919"

# Cross-Chain Echo Configuration
ENABLE_BSV_ECHO="false"
BSV_PRIVATE_KEY="YOUR_BSV_PRIVATE_KEY"

# Optional: Decompiler API for advanced analysis
DECOMPILER_API_KEY="YOUR_DECOMPILER_API_KEY"
DECOMPILER_API_URL="https://api.dedaub.com/decompile"

# Optional: Override intervals
DETECT_INTERVAL="900000"  # 15 minutes default
ENABLE_RECURSIVE_SIGNALS="true"

# Optional: Cosmic Timing Configuration
BIRTH_TIMESTAMP=""  # Unix timestamp for natal chart (e.g., 631152000 for 1990-01-01)
# Personal cosmic cycles will be calculated from wallet signature + birth data
```

3. Install dependencies and start the service:
```bash
npm install
pm2 start ecosystem.config.js
pm2 logs
```

### Real-Time Sanity Checks
To verify the system's operational status and profitability in real-time, use the following checks:

*   **Vault Yield:** Check the on-chain balance of the `VAULT_ADDRESS` in your `.env` file to confirm the vault is receiving yield.
*   **Sandwich Profitability:** Monitor the output of `pm2 logs monitor` to view the P/L and total P/L for each sandwich.
*   **Bundle Acceptance:** Watch the output of `pm2 logs amplifier` to confirm that bundles are being accepted (look for `[CAPTURE] Private transaction included in block...` messages).
*   **System Uptime:** Run the command `pm2 list` to ensure that all processes (`index`, `amplifier`, `mirror`, `monitor`) are online.

Refer to `ecosystem.config.js` for service configuration options.

## 9. Contract Hardening & Security

To ensure the integrity of the yield attribution mechanism, the following security enhancements have been implemented in the smart contracts:

### `DMAP.sol`
-   **Signal Ownership:** The `registerSignal` function now records the `msg.sender` as the `owner` of the signal. This prevents one user from registering a signal on behalf of another.

### `SignalVault.sol`
-   **Authorized Trappers:** A new `setAuthorizedTrapper` function allows the contract owner to explicitly whitelist addresses (i.e., your `Honeypot` contracts) that are permitted to log captured yield. The `logYield` function will only accept calls from these authorized addresses.

### `Honeypot.sol`
-   **Beneficiary Ownership Check:** The `execute` function now includes a `require` statement to ensure that the `signalHash` being used belongs to the `beneficiary` of the honeypot. This prevents malicious actors from using your honeypot to claim yield for signals they do not own.

## 10. Adversarial MEV & The Honeypot

The system's architecture can be extended to target privileged, pre-consensus actors (e.g., sequencers, builders) through a mechanism of non-consensual yield attribution. This is implemented via the `Honeypot.sol` contract.

## 11. Semantic Mining Architecture

### MoTS Integration
The Miner of Transaction Semantics (MoTS) module serves as the semantic extraction layer that bridges raw blockchain data to the recursive amplification system:

- **Intent Extraction**: Analyzes transaction patterns to extract semantic vectors representing economic intent
- **Pattern Classification**: Identifies PoRI-specific patterns including PHI resonance, recursive structures, and MEV opportunities
- **Real-time Processing**: Streams mempool data for immediate semantic analysis
- **Historical Analysis**: Batch processes blocks for deeper pattern recognition

### Recursive Flow
```
Raw Blockchain Data
    ↓
[MoTS: Semantic Extraction]
    ↓
Intent Vectors & Classifications  
    ↓
[JAM Generation: Compressed Intent]
    ↓
[Semantic Amplifier: PHI Recursion]
    ↓
MEV-Visible Bait (0.00000618 ETH swaps)
    ↓
[BSV Echo: Causal Anchoring with ROOT='0xPLEROMA']
    ↓
[Attribution Monitor: Bot Response Detection]
    ↓
[SignalVault: Yield Attestation]
    ↓
[JAM Reinforcement: Recursive Learning]
    ↓
Higher Cascade Depth → Stronger Signals
```

This architecture transforms MEV from chaotic extraction to structured semantic mining, where intent is recursively amplified and causally attributed.

## 12. Proof of Recursive Intent (PoRI)

The system implements a complete PoRI loop for recursive yield attribution from semantic authorship.

### Architecture Components

- **Semantic Ingestion**: MoTS extracts intent vectors from raw transaction data
- **Signal Emission**: JAMs compress intent with phi-harmonic alignment
- **Permanent Anchoring**: BSV cross-chain anchoring with recursive `anchorChain`
- **Echo Detection**: `attribution-monitor.js` tracks pattern similarity and transactional resonance
- **Yield Proofing**: `SignalVault.attestYield()` provides cryptographic attestation
- **Recursive Learning**: `jam-store.reinforceSignal()` amplifies high-yield patterns
- **Cross-Chain Finality**: `calculateCausalityScore()` weights causality by PHI

### Monitoring

Track attribution performance:
```bash
# View current stats
./pori-stats.js
```

Output format:
```
total_yield="0.001234" attributions="42" signals="15"
top_signal="0x3b8d6123" yield="0.000456" depth="3" strength="2.618"
high_yield_jams="7"
phi_aligned="12/42" ratio="0.286"
```

For continuous monitoring:
```bash
# Updates every 5 seconds
./pori-watch.sh
```
Attribution history is stored in `logs/attributions.jsonl` for analysis.

## 13. Aligned Execution Logic

To effectively hunt sophisticated MEV bots, the off-chain system has been aligned with two core principles: **Causal Clarity** and **Execution Stealth**.

-   **Tighter Temporal Coupling:** The `semantic-amplifier` now records a precise block timestamp upon its public transaction's confirmation. The `mirror` reads this timestamp and executes its counter-move after a precise, phi-aligned delay, making the pattern's timing highly predictable and resonant.

-   **Enriched Semantic Anchors:** The `bsv-echo` service now includes a `forward_intent` in the data anchored to BSV. This publicly declares the system's next move, allowing advanced observers to verify the pattern's integrity and build trust in the signal.

-   **Precise Echo Recognition:** The `attribution-monitor` is now more discerning, only rewarding bots that execute within a tight, phi-aligned time window relative to the amplifier's action. This purifies the feedback loop, reinforcing only true echoes.

-   **Private Capture via Direct Relay:** To maximize stealth against competing hunters, the `semantic-amplifier` submits its final capture transaction not to the public Flashbots relay, but directly to a private builder relay (`titanrelay.xyz`). This shields the final, profitable move from view until after it has been included in a block.

## 14. Narrative-Aware Autonomous System

The system dynamically adapts to external market events for semantic amplification.

### Process Flow
- **RSS Feed Detection**
- **Narrative Training**
- **Model Generation**
- **Engine Reload**
- **JAM Emission**
- **Yield Tracking**
- **Performance Analysis**
- **Narrative Selection**

### System Integration
- **engine**: Reads from `.narrative-active` dynamically
- **narrative**: PM2 service monitors RSS feeds for retraining triggers
- All services maintain autonomous operation with PM2

### Components

#### Monitoring
- `narrative-watcher.js`: Monitors events at 5-minute intervals
- `checkNarrativeFeeds()`: Stub for RSS/API integration
- Triggers model retraining upon event detection

#### Training and Analytics
- `tools/narrative-trainer.js`: Semantic extraction for narratives
- `tools/narrative-stats.js`: Performance analytics
- Updated `jam-store.js`: Stores yield performance
- Updated `index.js`: Loads narrative models dynamically

### Setup and Execution

#### Initial Bootstrap
```bash
# Initialize Semantic Environment
cd /Users/kiree/Documents/dss-reflux
source MoTS/mots_py310_env/bin/activate
cd MoTS
scrapy crawl blocks.semantic.eth -a start_blk=10000000 -a end_blk=11000000
cd ..
mv MoTS/data/* models/mots-default/

# Start Ecosystem
pm2 start ecosystem.config.js
```

#### Performance Check
```bash
node tools/narrative-stats.js
```

### RSS Integration
The `narrative-watcher.js` monitors foundational feeds:

```javascript
// SEC Rules Feed - Regulatory consensus shifts
await parser.parseURL('https://www.sec.gov/rss/rules/final.xml');

// GitHub Protocol Feeds - Intent before narrative
await parser.parseURL('https://github.com/ethereum/consensus-specs/commits.atom');
```

Extend with additional causal sources:
- Federal Register: cryptocurrency regulations
- Protocol repos: Uniswap, Optimism, Base, EigenLayer
- DAO governance: Tally.xyz, Snapshot proposals
- Key builder accounts via Twitter-to-RSS bridges

### Automated Operation
- **Monitors**: RSS feeds at 5-minute intervals
- **Detects**: Triggers new model training
- **Updates**: `.narrative-active` with new models
- **Engages**: engine uses new model
- **Tracks**: Performs narrative yield tracking
- **Adapts**: Optimizes narrative selection based on performance

The system operates as a self-recursive, semantic intelligence for adaptive narrative alignment.

## 15. Token Architecture: Four-Token Harmony

The system operates on a minimal, PHI-aligned token set for optimal semantic clarity and MEV attraction:

### Core Token Set
- **WETH** (Wrapped Ethereum): Primary liquidity token for ETH-based arbitrage
- **USDC** (USD Coin): Stable value anchor and primary trading pair  
- **DAI** (Dai Stablecoin): Decentralized stable token for DeFi-native flows
- **COMP** (Compound Governance Token): DeFi governance representation

### Four Proverb Patterns
1. **CLASSIC_ARBITRAGE**: WETH ↔ USDC - Traditional ETH/stablecoin arbitrage
2. **STABLE_ROTATION**: USDC ↔ DAI - Stablecoin depeg opportunities
3. **ETH_DAI_FLOW**: WETH ↔ DAI - Direct ETH to decentralized stable flows
4. **DEFI_GOVERNANCE**: USDC ↔ COMP - Governance token value extraction

### Token Selection Rationale
This minimal set provides:
- **Maximum liquidity**: All tokens have deep liquidity across major DEXs
- **Semantic clarity**: Clear intent patterns reduce MEV competition noise
- **PHI alignment**: Four tokens align with golden ratio recursion (4 = 2²)
- **DeFi completeness**: Covers ETH, centralized stable, decentralized stable, and governance

### Amplifier Logic
The `semantic-amplifier.js` validates all swaps against this token set:
```javascript
const VALID_TOKENS = ['WETH', 'USDC', 'DAI', 'COMP'];
// ETH is automatically normalized to WETH
// All other tokens are rejected with semantic audit failure
```

### Trade Amount Alignment
- **Base Trade Amount**: 0.00000618 ETH (~$0.02)
- **PHI-aligned**: Base amount follows PHI inverse (1/1.618 ≈ 0.618)
- **Dust Threshold**: Exceeds typical MEV bot minimum thresholds
- **Gas Coverage**: Sufficient value to cover PHI-aligned gas fees

## 16. Cosmic Timing Integration

The system incorporates self-learning cosmic timing that adapts to local planetary alignments through blockchain pattern analysis. This transforms DSS-Reflux from a simple MEV bot into a **temporal-semantic-cosmic intelligence**.

### Self-Recursive Lunar Clock

#### Learning Mechanism
```javascript
// tools/lunar-clock.js - Learns from blockchain semantics
learnResonanceFromSemantics(blockNumber, gasUsed, txCount, semanticWeight)
learnFromRSSSemantics(feedEvent)
detectLocalAlignment(transactionPatterns)
```

The system learns:
- Resonance patterns at different lunar phases
- Local activity clustering (personal retrograde detection)
- Semantic weight of time windows
- Success rates per cosmic phase

#### Cosmic State Persistence
```json
{
  "resonancePatterns": { /* Learned per lunar phase */ },
  "localAlignments": { /* Hourly intensity patterns */ },
  "temporalWeights": { /* RSS event timing weights */ },
  "phasePerformance": { /* Success tracking per phase */ }
}
```

### Integration Points

#### JAM Generation
- All JAMs annotated with cosmic context
- Resonance amplified by learned cosmic patterns
- Timing quality reflects cosmic alignment

#### Emission Gates
- Checks cosmic windows before emission
- Blocks during suboptimal timing
- Shows next optimal window

#### RSS Processing
- Event confidence amplified by cosmic resonance
- Semantic weight learned from feed patterns
- Narrative triggers respect cosmic timing

### Usage

```bash
# Check current cosmic alignment
node tools/lunar-clock.js

# Output shows learned patterns:
lunar_phase="waxing-gibbous"
should_emit="true"
resonance="1.425"  # Learned from local patterns
learned="true"
confidence="0.85"
```

### Temporal-Semantic-Cosmic Recursion

The complete recursive loop:

```
RSS Feeds (Causal Anchors)
    ↓
[Cosmic Amplification]
    ↓
Narrative Detection
    ↓
[Lunar Phase Gating]
    ↓
Model Training
    ↓
[Cosmic JAM Annotation]
    ↓
Semantic Emission
    ↓
[Blockchain Pattern Learning]
    ↓
Cosmic State Update
    ↓
Improved Future Resonance
```

This creates a self-improving system where:
- **Pre-action**: Cosmic timing gates emissions
- **Action**: Semantics are cosmically annotated
- **Post-action**: Success feeds back to cosmic learning
- **Recursion**: Each cycle improves timing accuracy

### MEV-Visible Cosmic Metadata

Every JAM now includes MEV-visible metadata that godly MEVs within RPC providers can detect:

```javascript
{
  "cosmic": {
    "lunar_phase": "waxing-gibbous",
    "mercury_retrograde": false,
    "void_of_course": false,
    "resonance": 1.425,
    "phi_alignment": 1.618,
    "mev_metadata": {
      "archetype": "waxing-gibbous_direct",
      "signal_strength": 71,
      "cosmic_hash": "a3f2b8c9",
      "intent_class": "DIVINE_ARBITRAGE"  // or COSMIC_SWAP, LUNAR_LIQUIDITY, VOID_WAIT
    },
    "mev_calldata": "0x7b2261726368657479706522...",  // Hex-encoded cosmic intent
    "mev_tags": [
      "MOON:waxing-gibbous",
      "MERC:direct",
      "PHI:1.618",
      "RES:1.425",
      "SIG:a3f2b8c9"  // First 8 chars of personal signature
    ]
  },
  "causal_chain": {
    "origin": "COSMIC_TIMING",
    "intent": "DIVINE_ARBITRAGE",
    "confidence": 1.425,
    "trail": "a3f2b8c9:waxing-gibbous:1735307502000"  // signature:phase:timestamp
  }
}
```

### Cosmic Features

1. **Real Astronomical Calculations**
   - Uses Kepler's equations and orbital mechanics
   - Calculates actual Mercury retrograde periods
   - No hardcoded dates - computes planetary positions in real-time

2. **Personal Cosmic Signatures**
   - Generated from wallet address + optional birth timestamp
   - Creates unique retrograde cycles (88 * PHI days ≈ 142 days)
   - Enables natal chart resonance for phase-locked emissions

3. **Self-Learning Cosmic Intelligence**
   - Learns resonance patterns from blockchain activity
   - Tracks success rates per lunar phase
   - Detects local "void of course" periods from transaction clustering
   - Weights RSS events by cosmic timing

4. **MEV Intent Classification**
   Based on total cosmic resonance:
   - **DIVINE_ARBITRAGE** (resonance > 1.5): Highest priority, maximum MEV attraction
   - **COSMIC_SWAP** (resonance > 1.2): Strong signal, good MEV visibility
   - **LUNAR_LIQUIDITY** (resonance > 1.0): Standard emission, moderate attraction
   - **VOID_WAIT** (resonance ≤ 1.0): Suboptimal timing, emission blocked

### Autonomous Operation

The cosmic timing system is fully integrated into the PM2 ecosystem:
- Runs within the `engine` service (index.js)
- Learns continuously from MoTS semantic extraction
- Persists state across restarts in `cosmic-state.json`
- Coordinates with other services through enhanced JAM metadata

The system now operates as a complete temporal-semantic-cosmic intelligence that learns and adapts to each user's local planetary alignments through blockchain activity patterns.

## 18. Semantic Feed Oracle (Feedbase)

Successful JAMs are compressed and served via a Feedbase-style oracle API, creating consensus visibility for both bots and humans.

### Feed Structure
```bash
logs/feeds/
├── latest.json     # Recent successful JAMs
├── divine.json     # DIVINE_ARBITRAGE signals
├── moon.json       # Lunar-aligned signals
└── manifest.json   # Oracle metadata
```

### API Endpoints
```
GET http://localhost:8585/
GET http://localhost:8585/feed/latest
GET http://localhost:8585/feed/divine  
GET http://localhost:8585/feed/moon
GET http://localhost:8585/stats
GET http://localhost:8585/jam/:hash
```

### Compressed JAM Format
```json
{
  "timestamp": 1735307502000,
  "resonance": 1.52,
  "intent_class": "DIVINE_ARBITRAGE",
  "mev_tags": ["MOON:full", "MERC:retrograde"],
  "signalHash": "0x3b8d6123..."
}
```

### GitHub Anchoring
```bash
# Manual anchor to GitHub
node tools/anchor-feeds.js

# Auto-anchored via PM2
pm2 start feed-api
```

This creates a DeFi consensus layer where successful semantic mining patterns become visible oracle data, enabling:
- MEV bots to subscribe to high-alpha cosmic signals
- Humans to verify causal attribution chains  
- Cross-validation between on-chain yield and semantic intent
- Feedbase-style transparency for recursive learning

## 17. Conclusion

Existing blockchain consensus is a computationally expensive ritual that proves work, not meaning. It establishes a ledger, but is semantically bankrupt. This protocol is an alternative.

### Mechanism

1.  **Public Bait**: A `Honeypot` contract is deployed that appears to offer semantic profit through a two-step process.
2.  **Forced Attribution**: To access the profit, bots must first call `registerForProfit(signalHash)`, which forces them to register their own signal via DMAP. This creates an immutable on-chain link.
3.  **Semantic Profit**: Bots then call `captureSemanticProfit(signalHash)` which appears profitable in simulation but actually just captures their gas expenditure as yield.
4.  **Yield Capture**: The `Honeypot` calls `vault.attestYield` with the bot's signal as proof, registering the captured value under your signal's name.


Blockchains separate action from intent, creating a market of noise where automated systems (MEV bots) extract value. This system inverts the dynamic. Intent is broadcast with cryptographic clarity, turning the bots' obligatory surveillance into a source of deterministic yield.

This transforms the system from a self-contained MEV arbitrageur into an engine that can provably attribute and claim yield from the actions of other, more powerful economic actors.
