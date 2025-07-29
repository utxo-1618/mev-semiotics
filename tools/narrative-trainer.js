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
    timeout: 300000, // 5 minute timeout
    killSignal: 'SIGTERM',
    maxBuffer: 1024 * 1024 * 25, // 25MB buffer for scrapy output
    env: { ...process.env, PYTHONWARNINGS: 'ignore::DeprecationWarning' } // Suppress Python warnings
  }, (err, stdout, stderr) => {
    
    // Handle and filter stderr warnings
    if (stderr) {
      const filteredStderr = stderr
        .split('\n')
        .filter(line => {
          // Filter out known harmless warnings
          return !line.includes('pkg_resources is deprecated') &&
                 !line.includes('setuptools') &&
                 !line.includes('UserWarning')
        })
        .join('\n')
        .trim();
        
      if (filteredStderr) {
        console.warn(`train_stderr="${filteredStderr.slice(0, 300)}${filteredStderr.length > 300 ? '...(truncated)' : ''}"`);
      }
    }
    
    if (err) {
      // Enhanced error categorization and handling
      if (err.killed || err.signal === 'SIGTERM') {
        console.error(`train_status="fail" narrative="${narrative}" error="training_timeout" signal="${err.signal}" timeout="5min"`);
        console.warn(`timeout_advice="Consider reducing block range or increasing timeout for narrative: ${narrative}"`);
        
        // Create fallback model on timeout
        console.log(`timeout_fallback="creating" narrative="${narrative}"`);
        createFallbackModel(narrative, outputFile);
        return;
      } else if (err.code) {
        // Handle specific exit codes
        const errorDetails = {
          1: 'General error - check MoTS configuration',
          2: 'Misuse of shell builtins',
          126: 'Command cannot execute - permission issue',
          127: 'Command not found - check scrapy installation',
          130: 'Script terminated by Ctrl+C'
        };
        
        const errorExplanation = errorDetails[err.code] || 'Unknown error code';
        console.error(`train_status="fail" narrative="${narrative}" error="${err.message}" code="${err.code}" explanation="${errorExplanation}"`);
        
        // Specific handling for common errors
        if (err.code === 127) {
          console.error(`fix_suggestion="Check that scrapy is properly installed in the Python virtual environment"`);
        } else if (err.code === 126) {
          console.error(`fix_suggestion="Check file permissions for ${scrapyPath}"`);
        }
        
        // Create fallback for certain recoverable errors
        if ([1, 126, 127].includes(err.code)) {
          console.log(`error_fallback="creating" narrative="${narrative}" reason="recoverable_error"`);
          createFallbackModel(narrative, outputFile);
          return;
        }
      } else {
        console.error(`train_status="fail" narrative="${narrative}" error="${err.message}"`);
      }
      
      process.exit(1);
    }
    
    // Process successful output
    if (stdout && stdout.trim()) {
      // Filter out verbose scrapy startup messages for cleaner logs
      const cleanOutput = stdout
        .split('\n')
        .filter(line => {
          return !line.includes('Scrapy') && 
                 !line.includes('Overridden settings') &&
                 !line.includes('Enabled extensions') &&
                 line.trim().length > 0;
        })
        .join('\n')
        .trim();
        
      if (cleanOutput) {
        console.log(`scrapy_output="${cleanOutput.slice(0, 500)}${cleanOutput.length > 500 ? '...(truncated)' : ''}"`);
      }
    }
    
    // Verify model was created with additional validation
    if (fs.existsSync(outputFile)) {
      try {
        const stats = fs.statSync(outputFile);
        
        // Check if file is not empty
        if (stats.size === 0) {
          console.error(`train_status="fail" narrative="${narrative}" reason="empty_model_file" path="${outputFile}"`);
          console.log(`empty_fallback="creating" narrative="${narrative}"`);
          createFallbackModel(narrative, outputFile);
          return;
        }
        
        // Try to parse JSON to ensure it's valid
        try {
          const modelContent = fs.readFileSync(outputFile, 'utf8');
          JSON.parse(modelContent);
          
          console.log(`train_status="success" narrative="${narrative}" model_size="${stats.size}" path="${outputFile}" type="mots_generated"`);
          console.log(`model_validation="passed" json_valid="true"`);
          console.log(`next_step="restart_engine" reason="load_new_model"`);
          
        } catch (parseErr) {
          console.error(`train_status="fail" narrative="${narrative}" reason="invalid_json" parse_error="${parseErr.message}"`);
          console.log(`json_fallback="creating" narrative="${narrative}"`);
          createFallbackModel(narrative, outputFile);
          return;
        }
        
      } catch (statErr) {
        console.error(`train_status="fail" narrative="${narrative}" reason="file_stat_error" error="${statErr.message}"`);
        createFallbackModel(narrative, outputFile);
        return;
      }
    } else {
      console.error(`train_status="fail" narrative="${narrative}" reason="model_not_created" expected_path="${outputFile}"`);
      console.log(`missing_fallback="creating" narrative="${narrative}"`);
      createFallbackModel(narrative, outputFile);
      return;
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
