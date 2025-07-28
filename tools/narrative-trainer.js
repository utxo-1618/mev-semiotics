#!/usr/bin/env node
// tools/narrative-trainer.js - Targeted semantic extraction for narrative alpha
// Usage: node tools/narrative-trainer.js <narrative_name> <start_block> <end_block>

const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const narrative = process.argv[2];
const startBlk = process.argv[3];
const endBlk = process.argv[4];

if (!narrative || !startBlk || !endBlk) {
    console.error('usage_err="missing_args" expected="<narrative> <start_block> <end_block>"');
    process.exit(1);
}

// Paths aligned with project structure
const projectRoot = path.resolve(__dirname, '..');
const motsPath = path.join(projectRoot, 'MoTS');
const venvPath = path.join(motsPath, 'mots_py310_env/bin/activate');
const modelDir = path.join(projectRoot, 'models');
const outputFile = path.join(modelDir, `mots-${narrative}.json`);

// Ensure models directory exists
if (!fs.existsSync(modelDir)) {
  fs.mkdirSync(modelDir, { recursive: true });
}

console.log(`narrative_train="init" target="${narrative}" blocks="${startBlk}-${endBlk}"`);

// Fallback function to create a basic model when MoTS is unavailable
function createFallbackModel(narrative, outputPath) {
  console.log(`creating_fallback_model="true" narrative="${narrative}"`);
  
  const fallbackModel = {
    narrative: narrative,
    timestamp: Date.now(),
    type: 'fallback',
    message: 'MoTS system unavailable - using default narrative',
    blocks: { start: startBlk, end: endBlk },
    semantic_data: {
      patterns: ['default_arbitrage', 'eth_flow'],
      confidence: 0.5,
      source: 'fallback_generator'
    }
  };
  
  try {
    fs.writeFileSync(outputPath, JSON.stringify(fallbackModel, null, 2));
    console.log(`train_status="success" narrative="${narrative}" model_size="${fs.statSync(outputPath).size}" path="${outputPath}" type="fallback"`);
    console.log(`next_step="restart_engine" reason="load_fallback_model"`);
    process.exit(0);
  } catch (e) {
    console.error(`fallback_creation_failed="${e.message}"`);
    process.exit(1);
  }
}

// Check system requirements and run training
function runTraining() {
  // Command construction with phi-aligned precision
  // Use python directly from venv to avoid shell sourcing issues
  const pythonPath = path.join(motsPath, 'mots_py310_env/bin/python');
  const scrapyPath = path.join(motsPath, 'mots_py310_env/bin/scrapy');

  // Check if virtual environment exists
  if (!fs.existsSync(pythonPath)) {
    console.error(`train_status="degraded" narrative="${narrative}" error="Python venv not found - using fallback"`);
    createFallbackModel(narrative, outputFile);
    return;
  }

  // Check if scrapy command exists
  if (!fs.existsSync(scrapyPath)) {
    console.error(`train_status="degraded" narrative="${narrative}" error="Scrapy not found - using fallback"`);
    createFallbackModel(narrative, outputFile);
    return;
  }

  // Ensure MoTS directory exists and has proper structure
  if (!fs.existsSync(path.join(motsPath, 'scrapy.cfg'))) {
    console.error(`train_status="degraded" narrative="${narrative}" error="MoTS scrapy project not found - using fallback"`);
    createFallbackModel(narrative, outputFile);
    return;
  }
  
  // All checks passed, run actual MoTS training
  runMoTSTraining(scrapyPath);
}

function runMoTSTraining(scrapyPath) {

// Use scrapy directly with full path
const cmd = `cd ${motsPath} && ${scrapyPath} crawl blocks.semantic.eth -a start_blk=${startBlk} -a end_blk=${endBlk} -o ${outputFile}`;

const child = exec(cmd, { 
    shell: '/bin/bash', 
    timeout: 120000, // 2 minute timeout
    killSignal: 'SIGTERM',
    maxBuffer: 1024 * 1024 * 10 // 10MB buffer for scrapy output
  }, (err, stdout, stderr) => {
    if (err) {
      if (err.killed || err.signal) {
        console.error(`train_status="fail" narrative="${narrative}" error="training_timeout_killed" signal="${err.signal}"`);
      } else {
        console.error(`train_status="fail" narrative="${narrative}" error="${err.message}" code="${err.code}"`);
      }
      if (stderr && stderr.trim()) {
        console.error(`stderr="${stderr.trim()}"`);
      }
      process.exit(1);
    }
    
    if (stdout && stdout.trim()) {
      console.log(`scrapy_output="${stdout.trim()}"`);
    }
    
    // Verify model was created
    if (fs.existsSync(outputFile)) {
      const stats = fs.statSync(outputFile);
      console.log(`train_status="success" narrative="${narrative}" model_size="${stats.size}" path="${outputFile}"`);
      console.log(`next_step="restart_engine" reason="load_new_model"`);
    } else {
      console.error(`train_status="fail" narrative="${narrative}" reason="model_not_created" expected_path="${outputFile}"`);
      process.exit(1);
    }
  });
  
  // Handle timeout explicitly
  child.on('error', (error) => {
    console.error(`exec_error="${error.message}" narrative="${narrative}"`);
  });
  
  // Log when command starts
  console.log(`exec_started="true" cmd="${cmd}" timeout="120s"`);
  
  // Setup cleanup on process exit
  process.on('SIGINT', () => {
    child.kill('SIGTERM');
    process.exit(1);
  });
}

// Start the training process
runTraining();
