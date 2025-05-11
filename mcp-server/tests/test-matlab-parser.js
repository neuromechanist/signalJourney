// Simple test script for the MATLAB parser
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// Try to load the MATLAB parser module directly
const basePath = path.resolve(__dirname, '..');
const matlabParserPath = path.join(basePath, 'src/services/codeParser/languages/matlab/matlab-parser.js');

// Ensure path exists
if (!fs.existsSync(matlabParserPath)) {
  console.error(`MATLAB parser not found at: ${matlabParserPath}`);
  process.exit(1);
}

// Define test fixture path
const testFixturePath = path.join(__dirname, 'unit/services/codeParser/fixtures/matlab/basic_functions.m');

// Ensure test fixture exists
if (!fs.existsSync(testFixturePath)) {
  console.error(`Test fixture not found at: ${testFixturePath}`);
  process.exit(1);
}

// Install dependencies
console.log('Installing required Node.js dependencies...');
const npmInstall = spawnSync('npm', ['install', 'tree-sitter', 'tree-sitter-matlab'], { 
  stdio: 'inherit',
  cwd: basePath
});

if (npmInstall.status !== 0) {
  console.error('Failed to install Node.js dependencies');
  process.exit(1);
}

// Read test fixture
const fixtureContent = fs.readFileSync(testFixturePath, 'utf-8');

// Dynamically load the parser
console.log('Loading MATLAB parser...');
try {
  // Install dependency if it fails to load
  try {
    require('tree-sitter');
    require('tree-sitter-matlab');
  } catch (err) {
    console.log('Could not load required modules, installing locally...');
    const localNpmInstall = spawnSync('npm', ['install', 'tree-sitter', 'tree-sitter-matlab'], {
      stdio: 'inherit',
      cwd: __dirname
    });
    
    if (localNpmInstall.status !== 0) {
      throw new Error('Failed to install local dependencies');
    }
  }
  
  const matlabParser = require(matlabParserPath);
  
  if (!matlabParser || typeof matlabParser.parse !== 'function') {
    console.error('Failed to load MATLAB parser module or it does not export a parse function');
    process.exit(1);
  }
  
  console.log('Parsing MATLAB code...');
  const result = matlabParser.parse(fixtureContent);
  
  // Display results
  console.log('Parsing successful!');
  console.log(`Found ${result.functionDefinitions?.length || 0} function definitions`);
  
  if (result.functionDefinitions && result.functionDefinitions.length > 0) {
    // Display function names
    const functionNames = result.functionDefinitions.map(fn => fn.name);
    console.log('Functions found:', functionNames.join(', '));
    
    // Check for expected functions
    const expectedFunctions = ['process_signal', 'moving_average'];
    const missingFunctions = expectedFunctions.filter(fn => !functionNames.includes(fn));
    
    if (missingFunctions.length > 0) {
      console.error('Missing expected functions:', missingFunctions.join(', '));
      process.exit(1);
    }
    
    console.log('All expected functions found!');
  } else {
    console.error('No function definitions found');
    console.log('Raw parser result:', JSON.stringify(result, null, 2));
    process.exit(1);
  }
  
  process.exit(0);
} catch (error) {
  console.error('Error with MATLAB parser:', error);
  process.exit(1);
} 