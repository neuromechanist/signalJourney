// Simple test script for the Python parser
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

// Define paths
const basePath = path.resolve(__dirname, '..');
const pythonScriptPath = path.join(basePath, 'src/services/codeParser/languages/python/libcst_parser.py');
const testFixturePath = path.join(__dirname, 'unit/services/codeParser/fixtures/python/basic_functions.py');
const venvPath = path.join(basePath, 'venv');
const venvPython = process.platform === 'win32' 
  ? path.join(venvPath, 'Scripts', 'python')
  : path.join(venvPath, 'bin', 'python3');
const venvPip = process.platform === 'win32'
  ? path.join(venvPath, 'Scripts', 'pip')
  : path.join(venvPath, 'bin', 'pip3');

// Ensure paths exist
if (!fs.existsSync(pythonScriptPath)) {
  console.error(`Python script not found at: ${pythonScriptPath}`);
  process.exit(1);
}

if (!fs.existsSync(testFixturePath)) {
  console.error(`Test fixture not found at: ${testFixturePath}`);
  process.exit(1);
}

// Setup virtual environment if it doesn't exist
if (!fs.existsSync(venvPath)) {
  console.log('Creating Python virtual environment...');
  const createVenv = spawnSync('python3', ['-m', 'venv', venvPath], { stdio: 'inherit' });
  
  if (createVenv.status !== 0) {
    console.error('Failed to create Python virtual environment');
    process.exit(1);
  }
}

// Install dependencies in virtual environment
console.log('Installing required Python dependencies in virtual environment...');
const pipInstall = spawnSync(venvPip, ['install', 'libcst'], { stdio: 'inherit' });

if (pipInstall.status !== 0) {
  console.error('Failed to install Python dependencies');
  process.exit(1);
}

// Read test fixture
const fixtureContent = fs.readFileSync(testFixturePath, 'utf-8');

// Run parser with virtual environment Python
console.log('Running Python parser...');
const pythonProcess = spawn(venvPython, [pythonScriptPath]);

// Handle errors
pythonProcess.stderr.on('data', (data) => {
  console.error(`Python parser error: ${data.toString()}`);
});

// Set up timeout
const timeout = setTimeout(() => {
  console.error('Python parser timed out after 10 seconds');
  pythonProcess.kill();
  process.exit(1);
}, 10000);

// Collect output
let output = '';
pythonProcess.stdout.on('data', (data) => {
  output += data.toString();
});

// Send content to parser
pythonProcess.stdin.write(fixtureContent);
pythonProcess.stdin.end();

// Process results
pythonProcess.on('close', (code) => {
  clearTimeout(timeout);
  
  if (code !== 0) {
    console.error(`Python parser exited with code ${code}`);
    process.exit(1);
  }
  
  try {
    const result = JSON.parse(output);
    console.log('Parsing successful!');
    console.log(`Found ${result.function_definitions.length} function definitions`);
    console.log(`Found ${result.function_calls.length} function calls`);
    
    // Display function names
    const functionNames = result.function_definitions.map(fn => fn.name);
    console.log('Functions found:', functionNames.join(', '));
    
    // Check for expected functions
    const expectedFunctions = ['simple_function', 'process_signal', 'analyze_signal'];
    const missingFunctions = expectedFunctions.filter(fn => !functionNames.includes(fn));
    
    if (missingFunctions.length > 0) {
      console.error('Missing expected functions:', missingFunctions.join(', '));
      process.exit(1);
    }
    
    console.log('All expected functions found!');
    process.exit(0);
  } catch (error) {
    console.error('Error parsing output:', error);
    console.error('Raw output:', output);
    process.exit(1);
  }
}); 