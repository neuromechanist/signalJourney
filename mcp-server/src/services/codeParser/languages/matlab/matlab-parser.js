/**
 * MATLAB code parser using tree-sitter-matlab
 * This module extracts function calls, function definitions, and their parameters from MATLAB code.
 */

const Parser = require('tree-sitter');
const MATLAB = require('tree-sitter-matlab');
const fs = require('fs');
const path = require('path');
const codeAst = require('code-ast');

// Initialize parser with MATLAB grammar
const parser = new Parser();
parser.setLanguage(MATLAB);

/**
 * Parse MATLAB code and extract function calls, definitions, and imports
 * @param {string} code MATLAB code content to parse
 * @returns {Object} Parsed information about the code
 */
function parseCode(code) {
  try {
    // Parse the code to create an AST
    const tree = parser.parse(code);
    const rootNode = tree.rootNode;
    
    // Initialize the result object
    const result = {
      function_calls: [],
      function_definitions: [],
      imports: [],
      errors: []
    };
    
    // Use code-ast to help traverse the tree
    const astHelper = codeAst.createAST(code, rootNode);
    
    // Extract function calls
    extractFunctionCalls(astHelper, result);
    
    // Extract function definitions
    extractFunctionDefinitions(astHelper, result);
    
    return result;
  } catch (error) {
    return {
      function_calls: [],
      function_definitions: [],
      imports: [],
      errors: [error.message || String(error)]
    };
  }
}

/**
 * Extract function calls from MATLAB code
 * @param {Object} astHelper code-ast helper object
 * @param {Object} result Result object to populate
 */
function extractFunctionCalls(astHelper, result) {
  // Find call expressions
  const callExpressions = astHelper.find({
    type: 'call_expression'
  });
  
  // Find command expressions (MATLAB's alternative syntax: command arg1 arg2)
  const commandExpressions = astHelper.find({
    type: 'command_expression'
  });
  
  // Process call expressions (standard syntax: func(arg1, arg2))
  callExpressions.forEach(node => {
    try {
      const { functionNode, args } = extractCallInfo(node, astHelper);
      
      if (functionNode) {
        // Get location information
        const location = {
          line: functionNode.startPosition.row + 1, // Tree-sitter is 0-based
          column: functionNode.startPosition.column + 1
        };
        
        // Add the function call to results
        result.function_calls.push({
          name: getFunctionName(functionNode),
          qualified_name: getFunctionName(functionNode),
          arguments: processArguments(args, astHelper),
          location,
          caller: getCurrentFunction(node, astHelper) || ''
        });
      }
    } catch (error) {
      // Skip problematic nodes but log them
      result.errors.push(`Error processing call expression: ${error.message}`);
    }
  });
  
  // Process command expressions (alternative syntax: func arg1 arg2)
  commandExpressions.forEach(node => {
    try {
      const firstChild = node.firstChild;
      if (firstChild && firstChild.type === 'identifier') {
        const funcName = firstChild.text;
        const args = node.namedChildren.slice(1); // Skip the first child (function name)
        
        // Get location information
        const location = {
          line: firstChild.startPosition.row + 1,
          column: firstChild.startPosition.column + 1
        };
        
        // Add the command call to results
        result.function_calls.push({
          name: funcName,
          qualified_name: funcName,
          arguments: processCommandArguments(args, astHelper),
          location,
          caller: getCurrentFunction(node, astHelper) || ''
        });
      }
    } catch (error) {
      // Skip problematic nodes but log them
      result.errors.push(`Error processing command expression: ${error.message}`);
    }
  });
}

/**
 * Extract function definitions from MATLAB code
 * @param {Object} astHelper code-ast helper object
 * @param {Object} result Result object to populate
 */
function extractFunctionDefinitions(astHelper, result) {
  // Find function definitions
  const functionDefinitions = astHelper.find({
    type: 'function_definition'
  });
  
  functionDefinitions.forEach(node => {
    try {
      // Function signature parts
      const signatureNode = node.childForFieldName('signature');
      if (!signatureNode) return;
      
      // Extract outputs
      const outputsNode = signatureNode.childForFieldName('outputs');
      const outputs = outputsNode ? extractFunctionOutputs(outputsNode) : [];
      
      // Extract function name
      const nameNode = signatureNode.childForFieldName('name');
      if (!nameNode) return;
      const functionName = nameNode.text;
      
      // Extract parameters
      const parametersNode = signatureNode.childForFieldName('parameters');
      const parameters = parametersNode ? extractFunctionParameters(parametersNode) : [];
      
      // Get function body for docstring
      const bodyNode = node.childForFieldName('body');
      const docstring = extractDocstring(bodyNode, astHelper);
      
      // Get location information
      const location = {
        line: nameNode.startPosition.row + 1,
        column: nameNode.startPosition.column + 1
      };
      
      // Add the function definition to results
      result.function_definitions.push({
        name: functionName,
        qualified_name: functionName,
        parameters: parameters.map(param => ({
          name: param,
          annotation: '',
          default_value: '',
          is_keyword_only: false,
          is_positional_only: true,
          is_variadic: false
        })),
        outputs: outputs,
        return_annotation: '',
        docstring: docstring || '',
        location,
        decorators: [],
        is_method: isMethodFunction(node, astHelper),
        is_async: false
      });
    } catch (error) {
      // Skip problematic nodes but log them
      result.errors.push(`Error processing function definition: ${error.message}`);
    }
  });
}

/**
 * Extract function call information from a call expression node
 * @param {Object} node Tree-sitter node
 * @param {Object} astHelper code-ast helper object
 * @returns {Object} Function node and arguments
 */
function extractCallInfo(node, astHelper) {
  const functionNode = node.childForFieldName('function');
  const argsNode = node.childForFieldName('arguments');
  
  return {
    functionNode,
    args: argsNode ? argsNode.namedChildren : []
  };
}

/**
 * Extract the function name from a function node
 * @param {Object} node Tree-sitter node
 * @returns {string} Function name
 */
function getFunctionName(node) {
  if (node.type === 'identifier') {
    return node.text;
  } else if (node.type === 'member_expression') {
    const object = node.childForFieldName('object');
    const field = node.childForFieldName('field');
    
    if (object && field) {
      const objectName = object.type === 'member_expression' ? 
        getFunctionName(object) : object.text;
      return `${objectName}.${field.text}`;
    }
  }
  
  return node.text;
}

/**
 * Process call arguments into a structured format
 * @param {Array} args Array of argument nodes
 * @param {Object} astHelper code-ast helper object
 * @returns {Object} Structured arguments (positional and keywords)
 */
function processArguments(args, astHelper) {
  const result = {
    positional: [],
    keywords: {}
  };
  
  // For MATLAB, we need to handle:
  // 1. Regular positional args
  // 2. Name-value pairs (special case in MATLAB)
  
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    
    // Check if this could be a name in a name-value pair
    if (i < args.length - 1 && isStringLiteral(arg)) {
      const potentialName = getStringValue(arg);
      // If it starts with a letter and contains only letters, numbers, or underscores,
      // it's likely a parameter name
      if (/^[a-zA-Z][a-zA-Z0-9_]*$/.test(potentialName)) {
        const value = args[i + 1];
        result.keywords[potentialName] = getNodeValue(value);
        i += 2; // Skip both name and value
        continue;
      }
    }
    
    // Regular positional argument
    result.positional.push(getNodeValue(arg));
    i++;
  }
  
  return result;
}

/**
 * Process command arguments (space-separated syntax)
 * @param {Array} args Array of argument nodes
 * @param {Object} astHelper code-ast helper object
 * @returns {Object} Structured arguments (positional only, as commands don't have named args)
 */
function processCommandArguments(args, astHelper) {
  return {
    positional: args.map(arg => getNodeValue(arg)),
    keywords: {}
  };
}

/**
 * Check if a node is a string literal
 * @param {Object} node Tree-sitter node
 * @returns {boolean} Whether it's a string literal
 */
function isStringLiteral(node) {
  return node.type === 'string' || node.type === 'char';
}

/**
 * Get the string value from a string literal node
 * @param {Object} node Tree-sitter node
 * @returns {string} String value without quotes
 */
function getStringValue(node) {
  if (node.type === 'string' || node.type === 'char') {
    // Remove quotes from the string
    let text = node.text;
    if ((text.startsWith("'") && text.endsWith("'")) || 
        (text.startsWith('"') && text.endsWith('"'))) {
      return text.slice(1, -1);
    }
    return text;
  }
  return node.text;
}

/**
 * Get a JavaScript representation of a node's value
 * @param {Object} node Tree-sitter node
 * @returns {*} Value representation
 */
function getNodeValue(node) {
  switch (node.type) {
    case 'string':
    case 'char':
      return getStringValue(node);
    case 'number':
      return parseFloat(node.text);
    case 'true':
      return true;
    case 'false':
      return false;
    case 'array':
      return '...'; // Placeholder for complex types
    case 'cell_array':
      return '...';
    default:
      return node.text;
  }
}

/**
 * Extract function outputs from an outputs node
 * @param {Object} outputsNode Tree-sitter node
 * @returns {Array} Array of output parameter names
 */
function extractFunctionOutputs(outputsNode) {
  // For single output
  if (outputsNode.type === 'identifier') {
    return [outputsNode.text];
  }
  
  // For multiple outputs in brackets [out1, out2, ...]
  if (outputsNode.type === 'output_parameters') {
    return outputsNode.namedChildren
      .filter(child => child.type === 'identifier')
      .map(child => child.text);
  }
  
  return [];
}

/**
 * Extract function parameters from a parameters node
 * @param {Object} parametersNode Tree-sitter node
 * @returns {Array} Array of parameter names
 */
function extractFunctionParameters(parametersNode) {
  return parametersNode.namedChildren
    .filter(child => child.type === 'identifier')
    .map(child => child.text);
}

/**
 * Extract docstring from a function body
 * @param {Object} bodyNode Tree-sitter body node
 * @param {Object} astHelper code-ast helper object
 * @returns {string} Docstring or empty string
 */
function extractDocstring(bodyNode, astHelper) {
  if (!bodyNode || !bodyNode.namedChildren || bodyNode.namedChildren.length === 0) {
    return '';
  }
  
  // Look for comment nodes at the beginning of the function body
  const comments = [];
  for (let i = 0; i < bodyNode.namedChildren.length; i++) {
    const child = bodyNode.namedChildren[i];
    
    // If we find a comment, add it to our docstring
    if (child.type === 'comment_block' || child.type === 'comment') {
      // Extract the comment text without the comment markers
      let commentText = child.text;
      if (commentText.startsWith('%')) {
        commentText = commentText.substring(1).trim();
      }
      comments.push(commentText);
    } else if (child.type !== 'blank_statement') {
      // If we encounter a non-comment, non-blank node, stop collecting comments
      break;
    }
  }
  
  return comments.join('\n');
}

/**
 * Determine if a function is a method (part of a class)
 * @param {Object} node Function definition node
 * @param {Object} astHelper code-ast helper object
 * @returns {boolean} Whether the function is a method
 */
function isMethodFunction(node, astHelper) {
  // Look for class definition as an ancestor
  let current = node.parent;
  while (current) {
    if (current.type === 'class_definition') {
      return true;
    }
    current = current.parent;
  }
  return false;
}

/**
 * Find the name of the current function containing this node
 * @param {Object} node Tree-sitter node
 * @param {Object} astHelper code-ast helper object
 * @returns {string|null} Name of the containing function or null
 */
function getCurrentFunction(node, astHelper) {
  // Find the nearest function definition ancestor
  let current = node.parent;
  while (current) {
    if (current.type === 'function_definition') {
      const signature = current.childForFieldName('signature');
      if (signature) {
        const nameNode = signature.childForFieldName('name');
        if (nameNode) {
          return nameNode.text;
        }
      }
      break;
    }
    current = current.parent;
  }
  return null;
}

/**
 * Main entry point for command-line usage
 */
function main() {
  if (process.argv.length > 2) {
    const filePath = process.argv[2];
    try {
      const code = fs.readFileSync(filePath, 'utf-8');
      const result = parseCode(code);
      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      console.error(JSON.stringify({ error: error.message }, null, 2));
      process.exit(1);
    }
  } else {
    // Read from stdin if no file path provided
    let code = '';
    process.stdin.on('data', chunk => {
      code += chunk;
    });
    
    process.stdin.on('end', () => {
      const result = parseCode(code);
      console.log(JSON.stringify(result, null, 2));
    });
  }
}

// Export functions for usage as module
module.exports = {
  parseCode,
  main
};

// Run main if called directly
if (require.main === module) {
  main();
} 