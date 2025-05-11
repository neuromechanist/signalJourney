// Standalone test file for code parsers
const fs = require('fs');
const path = require('path');

// Find base directories
const currentDir = __dirname;
const testsDir = path.resolve(currentDir, '../../..');
const srcDir = path.resolve(testsDir, '../src');
const codeParserDir = path.join(srcDir, 'services/codeParser');

// Import parser modules - direct references to avoid TypeScript issues
const pythonParserModule = require(path.join(codeParserDir, 'languages/python/index.js'));
const matlabParserModule = require(path.join(codeParserDir, 'languages/matlab/index.js'));
const normalizerModule = require(path.join(codeParserDir, 'normalizer.js'));
const typesModule = require(path.join(codeParserDir, 'types.js'));

// Extract the classes
const PythonParser = pythonParserModule.PythonParser;
const MatlabParser = matlabParserModule.MatlabParser;
const ParserOutputNormalizer = normalizerModule.ParserOutputNormalizer;
const SupportedLanguage = typesModule.SupportedLanguage;

// Setup
const fixturesDir = path.join(__dirname, 'fixtures');
const pythonFixturesDir = path.join(fixturesDir, 'python');
const matlabFixturesDir = path.join(fixturesDir, 'matlab');

const basicPythonPath = path.join(pythonFixturesDir, 'basic_functions.py');
const advancedPythonPath = path.join(pythonFixturesDir, 'advanced_patterns.py');
const basicMatlabPath = path.join(matlabFixturesDir, 'basic_functions.m');
const advancedMatlabPath = path.join(matlabFixturesDir, 'advanced_patterns.m');

// Log the paths to make debugging easier
console.log('Paths:');
console.log('  Python Parser:', path.join(codeParserDir, 'languages/python/index.js'));
console.log('  MATLAB Parser:', path.join(codeParserDir, 'languages/matlab/index.js'));
console.log('  Python Fixture:', basicPythonPath);
console.log('  MATLAB Fixture:', basicMatlabPath);

// Initialize parsers and normalizer
let pythonParser, matlabParser, normalizer;
try {
  console.log('Creating parser instances...');
  pythonParser = new PythonParser();
  matlabParser = new MatlabParser();
  normalizer = new ParserOutputNormalizer();
  console.log('Parser instances created successfully');
} catch (error) {
  console.error('Error creating parser instances:', error);
  process.exit(1);
}

// Test functions
async function testPythonParser() {
  console.log('Testing Python Parser...');
  
  try {
    // Read fixture content
    const basicPythonContent = fs.readFileSync(basicPythonPath, 'utf-8');
    
    // Parse content
    const parseResult = await pythonParser.parseContent(
      basicPythonContent,
      SupportedLanguage.PYTHON
    );
    
    // Normalize result
    const normalizedResult = normalizer.normalizeResult(
      parseResult,
      SupportedLanguage.PYTHON,
      'PythonParser'
    );
    
    // Validate results
    console.log(`Found ${normalizedResult.functionDefinitions.length} function definitions`);
    console.log(`Found ${normalizedResult.functionCalls.length} function calls`);
    
    // List function names found
    const functionNames = normalizedResult.functionDefinitions.map(fn => fn.name);
    console.log('Functions found:', functionNames.join(', '));
    
    // Check for expected function names
    const expectedFunctions = ['simple_function', 'process_signal', 'analyze_signal'];
    const missingFunctions = expectedFunctions.filter(fn => !functionNames.includes(fn));
    
    if (missingFunctions.length > 0) {
      console.error('FAIL: Missing expected functions:', missingFunctions.join(', '));
      return false;
    }
    
    console.log('SUCCESS: Python parser working correctly');
    return true;
  } catch (error) {
    console.error('Error in Python parser test:', error);
    return false;
  }
}

async function testMatlabParser() {
  console.log('Testing MATLAB Parser...');
  
  try {
    // Read fixture content
    const basicMatlabContent = fs.readFileSync(basicMatlabPath, 'utf-8');
    
    // Parse content
    const parseResult = await matlabParser.parseContent(
      basicMatlabContent,
      SupportedLanguage.MATLAB
    );
    
    // Normalize result
    const normalizedResult = normalizer.normalizeResult(
      parseResult,
      SupportedLanguage.MATLAB,
      'MatlabParser'
    );
    
    // Validate results
    console.log(`Found ${normalizedResult.functionDefinitions.length} function definitions`);
    console.log(`Found ${normalizedResult.functionCalls.length} function calls`);
    
    // List function names found
    const functionNames = normalizedResult.functionDefinitions.map(fn => fn.name);
    console.log('Functions found:', functionNames.join(', '));
    
    // Check for expected function names
    const expectedFunctions = ['process_signal', 'moving_average'];
    const missingFunctions = expectedFunctions.filter(fn => !functionNames.includes(fn));
    
    if (missingFunctions.length > 0) {
      console.error('FAIL: Missing expected functions:', missingFunctions.join(', '));
      return false;
    }
    
    console.log('SUCCESS: MATLAB parser working correctly');
    return true;
  } catch (error) {
    console.error('Error in MATLAB parser test:', error);
    return false;
  }
}

// Run tests
async function runTests() {
  console.log('Starting parser tests...');
  
  try {
    // Test Python parser
    const pythonSuccess = await testPythonParser();
    
    // Test MATLAB parser
    const matlabSuccess = await testMatlabParser();
    
    // Overall result
    if (pythonSuccess && matlabSuccess) {
      console.log('✅ All parser tests passed!');
      process.exit(0);
    } else {
      console.error('❌ Some parser tests failed');
      process.exit(1);
    }
  } catch (error) {
    console.error('Error running tests:', error);
    process.exit(1);
  }
}

// Run the tests
runTests(); 