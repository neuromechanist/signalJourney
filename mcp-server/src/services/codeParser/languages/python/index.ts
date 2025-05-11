/**
 * Python code parser implementation.
 * Parses Python code to extract function calls, definitions, and relationships.
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

import logger from '@/utils/logger';
import { BaseCodeParser } from '../../baseParser';
import {
  ICodeParserResult,
  IFunctionCall,
  IFunctionDefinition,
  IFunctionParameter,
  IParserOptions,
  SupportedLanguage,
  IVariable,
  IImport
} from '../../types';
import { McpApplicationError } from '@/core/mcp-types';

// Map Python parser types to our TypeScript interfaces
interface PyFunctionParameter {
  name: string | null;
  value?: string;
  position: number;
  is_named: boolean;
  is_vararg?: boolean;
  is_kwarg?: boolean;
  is_kwargs_unpacking?: boolean;
  annotation?: string;
  default?: string;
  keyword_only?: boolean;
}

interface PyFunctionCall {
  name: string;
  qualified_name: string;
  arguments: PyFunctionParameter[];
  line: number;
  column: number;
  caller?: string;
  class_context?: string;
}

interface PyFunctionDefinition {
  name: string;
  qualified_name: string;
  parameters: {
    name: string;
    annotation?: string;
    default?: string;
    is_vararg?: boolean;
    is_kwarg?: boolean;
    keyword_only?: boolean;
  }[];
  return_annotation?: string;
  decorators: string[];
  line: number;
  column: number;
  class_context?: string;
}

interface PyVariable {
  name: string;
  line: number;
  column: number;
  scope: string;
}

interface PyImport {
  type: 'import' | 'importfrom';
  name: string;
  alias?: string;
  module?: string;
  full_name?: string;
  line: number;
  column: number;
}

interface PyParseResult {
  language: string;
  source_file?: string;
  function_calls: PyFunctionCall[];
  function_definitions: PyFunctionDefinition[];
  variables: PyVariable[];
  imports: PyImport[];
  error?: string;
  error_line?: number;
  error_offset?: number;
}

/**
 * Parser for Python code
 */
export class PythonCodeParser extends BaseCodeParser {
  private pythonScriptPath: string;
  private fallbackToRegex: boolean;
  
  /**
   * Creates a new Python parser
   */
  constructor() {
    super(SupportedLanguage.Python);
    
    // Find the path to the Python script relative to this file
    this.pythonScriptPath = path.join(__dirname, 'pyparser.py');
    this.fallbackToRegex = false;
    
    // Check if the Python script exists
    if (!fs.existsSync(this.pythonScriptPath)) {
      logger.warn(`Python parser script not found at ${this.pythonScriptPath}. Will use regex fallback.`);
      this.fallbackToRegex = true;
    }
  }

  /**
   * Parse a Python file to extract functions and function calls
   * @param filePath Path to the Python file
   * @param options Parser options
   * @returns Parsed result with function calls and definitions
   */
  public async parseFile(filePath: string, options?: IParserOptions): Promise<ICodeParserResult> {
    try {
      // Check if file exists
      if (!fs.existsSync(filePath)) {
        throw new McpApplicationError(`File not found: ${filePath}`);
      }
      
      // Read file content and parse
      const content = await fs.promises.readFile(filePath, 'utf-8');
      return this.parseContent(content, filePath, options);
    } catch (error) {
      logger.error(`Error parsing Python file ${filePath}:`, error);
      
      // Return empty result with error
      return {
        language: SupportedLanguage.Python,
        sourceFile: filePath,
        functionCalls: [],
        functionDefinitions: [],
        variables: [],
        imports: [],
        errors: [error instanceof Error ? error.message : String(error)]
      };
    }
  }

  /**
   * Parse Python code content
   * @param content Python code as string
   * @param filePath Optional source file path for reference
   * @param options Parser options
   * @returns Parsed result with function calls and definitions
   */
  public parseContent(content: string, filePath?: string, options?: IParserOptions): ICodeParserResult {
    // If we can use the Python parser, try it first
    if (!this.fallbackToRegex) {
      try {
        const result = this.parseWithPythonAST(content, filePath);
        
        // If we get a valid result, return it
        if (result) {
          return result;
        }
      } catch (error) {
        logger.warn(`Python AST parser failed, falling back to regex: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    
    // Fall back to regex-based parsing
    return this.parseWithRegex(content, filePath);
  }
  
  /**
   * Parse Python code using the Python AST parser script
   * @param content Python code content
   * @param filePath Optional source file path for reference
   * @returns Parsed result or null if parsing failed
   */
  private parseWithPythonAST(content: string, filePath?: string): ICodeParserResult | null {
    return new Promise<ICodeParserResult | null>((resolve, reject) => {
      // Spawn Python process
      const pythonProcess = spawn('python', [this.pythonScriptPath]);
      let stdout = '';
      let stderr = '';
      
      // Handle stdout data
      pythonProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      // Handle stderr data
      pythonProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      // Handle process completion
      pythonProcess.on('close', (code) => {
        if (code === 0) {
          try {
            // Parse the JSON output
            const pyResult: PyParseResult = JSON.parse(stdout);
            
            // Convert to our interface format
            const result: ICodeParserResult = {
              language: SupportedLanguage.Python,
              sourceFile: filePath || pyResult.source_file,
              functionCalls: this.convertPyFunctionCalls(pyResult.function_calls),
              functionDefinitions: this.convertPyFunctionDefinitions(pyResult.function_definitions),
              variables: this.convertPyVariables(pyResult.variables),
              imports: this.convertPyImports(pyResult.imports),
              errors: pyResult.error ? [pyResult.error] : []
            };
            
            resolve(result);
          } catch (error) {
            logger.error('Error parsing Python AST result:', error);
            resolve(null); // Return null to trigger fallback
          }
        } else {
          logger.warn(`Python process exited with code ${code}`);
          logger.debug(`Python stderr: ${stderr}`);
          resolve(null); // Return null to trigger fallback
        }
      });
      
      // Handle process error
      pythonProcess.on('error', (error) => {
        logger.error('Error spawning Python process:', error);
        resolve(null); // Return null to trigger fallback
      });
      
      // Send code to the Python process
      pythonProcess.stdin.write(content);
      pythonProcess.stdin.end();
    });
  }
  
  /**
   * Parse Python code using regex patterns (fallback method)
   * @param content Python code content
   * @param filePath Optional source file path for reference
   * @returns Parsed result with basic function calls
   */
  private parseWithRegex(content: string, filePath?: string): ICodeParserResult {
    logger.debug(`Using regex fallback for Python parsing of ${filePath || 'content'}`);
    
    const functionCalls: IFunctionCall[] = [];
    const functionDefinitions: IFunctionDefinition[] = [];
    const variables: IVariable[] = [];
    const imports: IImport[] = [];
    
    // Basic regex to find function calls
    // This is a simple approach and won't catch everything
    const functionCallRegex = /(\w+(?:\.\w+)*)\s*\((.*?)\)/g;
    
    // Process each line to maintain line numbers
    const lines = content.split('\n');
    
    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
      const line = lines[lineNum];
      
      // Skip comments
      if (line.trim().startsWith('#')) {
        continue;
      }
      
      // Extract function calls
      let match;
      while ((match = functionCallRegex.exec(line)) !== null) {
        const [fullMatch, funcName, argsStr] = match;
        
        // Split arguments by comma, but respect nested parentheses
        const args = this.splitArguments(argsStr);
        
        // Create function call object
        const call: IFunctionCall = {
          name: funcName,
          qualifiedName: funcName,
          sourceLocation: {
            file: filePath || 'unknown',
            line: lineNum + 1,
            column: match.index
          },
          parameters: args.map((arg, index) => {
            // Check if it's a named argument (has '=' in it)
            const isNamed = arg.includes('=');
            let name: string | undefined;
            let value = arg.trim();
            
            if (isNamed) {
              const parts = arg.split('=');
              name = parts[0].trim();
              value = parts.slice(1).join('=').trim();
            }
            
            return {
              name,
              value,
              position: index,
              isNamed
            };
          })
        };
        
        functionCalls.push(call);
      }
      
      // Simple regex for function definitions
      const funcDefRegex = /def\s+(\w+)\s*\((.*?)\)(?:\s*->.*?)?:/;
      const funcDefMatch = funcDefRegex.exec(line);
      
      if (funcDefMatch) {
        const [_, funcName, paramsStr] = funcDefMatch;
        const params = this.splitArguments(paramsStr);
        
        // Create function definition
        const def: IFunctionDefinition = {
          name: funcName,
          qualifiedName: funcName,
          sourceLocation: {
            file: filePath || 'unknown',
            line: lineNum + 1,
            column: line.indexOf('def ')
          },
          parameters: params.map((param, index) => {
            // Handle default values and annotations
            let name = param.trim();
            let defaultValue: string | undefined;
            let typeAnnotation: string | undefined;
            
            // Check for default value
            if (name.includes('=')) {
              const parts = name.split('=');
              name = parts[0].trim();
              defaultValue = parts[1].trim();
            }
            
            // Check for type annotation
            if (name.includes(':')) {
              const parts = name.split(':');
              name = parts[0].trim();
              typeAnnotation = parts[1].trim();
            }
            
            return {
              name,
              position: index,
              typeAnnotation,
              defaultValue,
              isNamed: false
            };
          })
        };
        
        functionDefinitions.push(def);
      }
      
      // Simple regex for imports
      const importRegex = /^\s*import\s+(.+)$/;
      const importMatch = importRegex.exec(line);
      
      if (importMatch) {
        const modulesStr = importMatch[1];
        const modules = modulesStr.split(',').map(m => m.trim());
        
        for (const module of modules) {
          imports.push({
            name: module,
            sourceLocation: {
              file: filePath || 'unknown',
              line: lineNum + 1,
              column: line.indexOf('import')
            },
            type: 'import'
          });
        }
      }
      
      // Check for from ... import
      const fromImportRegex = /^\s*from\s+(.+?)\s+import\s+(.+)$/;
      const fromImportMatch = fromImportRegex.exec(line);
      
      if (fromImportMatch) {
        const [_, fromModule, importsStr] = fromImportMatch;
        const importItems = importsStr.split(',').map(i => i.trim());
        
        for (const item of importItems) {
          imports.push({
            name: item,
            sourceLocation: {
              file: filePath || 'unknown',
              line: lineNum + 1,
              column: line.indexOf('import')
            },
            type: 'importFrom',
            module: fromModule
          });
        }
      }
      
      // Simple regex for variable assignments
      const assignmentRegex = /^\s*(\w+)\s*=/;
      const assignmentMatch = assignmentRegex.exec(line);
      
      if (assignmentMatch && !line.includes('def ')) {
        const varName = assignmentMatch[1];
        
        variables.push({
          name: varName,
          sourceLocation: {
            file: filePath || 'unknown',
            line: lineNum + 1,
            column: line.indexOf(varName)
          }
        });
      }
    }
    
    return {
      language: SupportedLanguage.Python,
      sourceFile: filePath,
      functionCalls,
      functionDefinitions,
      variables,
      imports
    };
  }
  
  /**
   * Split function arguments respecting nested parentheses and brackets
   * @param argsStr String containing function arguments
   * @returns Array of argument strings
   */
  private splitArguments(argsStr: string): string[] {
    const args: string[] = [];
    let current = '';
    let depth = 0;
    let inString = false;
    let stringChar = '';
    
    for (let i = 0; i < argsStr.length; i++) {
      const char = argsStr[i];
      
      if (inString) {
        current += char;
        // Check for escaped quotes
        if (char === '\\') {
          // Skip the next character as it's escaped
          current += argsStr[++i] || '';
          continue;
        }
        if (char === stringChar) {
          inString = false;
        }
      } else if (char === '"' || char === "'") {
        current += char;
        inString = true;
        stringChar = char;
      } else if (char === '(' || char === '[' || char === '{') {
        current += char;
        depth++;
      } else if (char === ')' || char === ']' || char === '}') {
        current += char;
        depth--;
      } else if (char === ',' && depth === 0) {
        // Only split on commas at the top level
        args.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    
    // Add the last argument if not empty
    if (current.trim()) {
      args.push(current.trim());
    }
    
    return args;
  }
  
  /**
   * Convert Python function calls to our interface format
   * @param pyCalls Python function calls
   * @returns Converted function calls
   */
  private convertPyFunctionCalls(pyCalls: PyFunctionCall[]): IFunctionCall[] {
    return pyCalls.map(call => ({
      name: call.name,
      qualifiedName: call.qualified_name,
      sourceLocation: {
        line: call.line,
        column: call.column
      },
      caller: call.caller,
      classContext: call.class_context,
      parameters: call.arguments.map(arg => this.convertPyParameter(arg))
    }));
  }
  
  /**
   * Convert Python function definitions to our interface format
   * @param pyDefs Python function definitions
   * @returns Converted function definitions
   */
  private convertPyFunctionDefinitions(pyDefs: PyFunctionDefinition[]): IFunctionDefinition[] {
    return pyDefs.map(def => ({
      name: def.name,
      qualifiedName: def.qualified_name,
      sourceLocation: {
        line: def.line,
        column: def.column
      },
      classContext: def.class_context,
      parameters: def.parameters.map((param, index) => ({
        name: param.name,
        position: index,
        typeAnnotation: param.annotation,
        defaultValue: param.default,
        isNamed: Boolean(param.keyword_only),
        isVararg: Boolean(param.is_vararg),
        isKwarg: Boolean(param.is_kwarg)
      })),
      returnType: def.return_annotation,
      decorators: def.decorators
    }));
  }
  
  /**
   * Convert Python variables to our interface format
   * @param pyVars Python variables
   * @returns Converted variables
   */
  private convertPyVariables(pyVars: PyVariable[]): IVariable[] {
    return pyVars.map(v => ({
      name: v.name,
      sourceLocation: {
        line: v.line,
        column: v.column
      },
      scope: v.scope
    }));
  }
  
  /**
   * Convert Python imports to our interface format
   * @param pyImports Python imports
   * @returns Converted imports
   */
  private convertPyImports(pyImports: PyImport[]): IImport[] {
    return pyImports.map(imp => ({
      name: imp.name,
      sourceLocation: {
        line: imp.line,
        column: imp.column
      },
      type: imp.type === 'importfrom' ? 'importFrom' : 'import',
      module: imp.module,
      alias: imp.alias
    }));
  }
  
  /**
   * Convert Python parameter to our interface format
   * @param pyParam Python parameter
   * @returns Converted parameter
   */
  private convertPyParameter(pyParam: PyFunctionParameter): IFunctionParameter {
    return {
      name: pyParam.name || undefined,
      value: pyParam.value,
      position: pyParam.position,
      isNamed: pyParam.is_named,
      isVararg: pyParam.is_vararg,
      isKwarg: pyParam.is_kwarg
    };
  }
} 