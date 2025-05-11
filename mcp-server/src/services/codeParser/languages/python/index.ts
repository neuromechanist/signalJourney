/**
 * Python code parser implementation.
 * Parses Python code to extract function calls, definitions, and relationships.
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { execFile } from 'child_process';
import { promisify } from 'util';

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
  IImport,
  ICodeParser,
  CodeParserOptions,
  FunctionCall,
  FunctionDefinition,
  ImportStatement
} from '../../types';
import { McpApplicationError } from '@/core/mcp-types';
import { CodeParserId } from '../../parserFactory';

const execFileAsync = promisify(execFile);

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

interface LibCSTParserResult {
  function_calls: {
    name: string;
    qualified_name: string;
    arguments: {
      positional: any[];
      keywords: Record<string, any>;
    };
    location: {
      line: number;
      column: number;
    } | null;
    caller: string;
  }[];
  function_definitions: {
    name: string;
    qualified_name: string;
    parameters: {
      name: string;
      annotation: string;
      default_value: string;
      is_keyword_only: boolean;
      is_positional_only: boolean;
      is_variadic: boolean;
    }[];
    return_annotation: string;
    docstring: string;
    location: {
      line: number;
      column: number;
    } | null;
    decorators: string[];
    is_method: boolean;
    is_async: boolean;
  }[];
  imports: {
    module: string;
    name: string;
    alias: string;
    location: {
      line: number;
      column: number;
    } | null;
  }[];
  errors: string[];
}

/**
 * Parser for Python code
 */
export class PythonParser extends BaseCodeParser implements ICodeParser {
  private pythonScriptPath: string;
  private fallbackToRegex: boolean;
  
  /**
   * Creates a new Python parser
   */
  constructor() {
    super(SupportedLanguage.Python);
    
    // Find the path to the Python script relative to this file
    this.pythonScriptPath = path.join(__dirname, 'libcst_parser.py');
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
    if (!filePath.endsWith('.py')) {
      throw new Error('File is not a Python file');
    }

    try {
      return await this.parseWithLibCST(filePath);
    } catch (error) {
      logger.warn(`Failed to parse with LibCST: ${error}. Falling back to regex parser.`);
      // Fallback to regex-based parsing
      return this.fallbackRegexParse(filePath);
    }
  }

  /**
   * Parse Python code content
   * @param content Python code as string
   * @param filePath Optional source file path for reference
   * @param options Parser options
   * @returns Parsed result with function calls and definitions
   */
  public async parseContent(content: string, options?: IParserOptions): Promise<ICodeParserResult> {
    try {
      return await this.parseContentWithLibCST(content);
    } catch (error) {
      logger.warn(`Failed to parse content with LibCST: ${error}. Falling back to regex parser.`);
      // Fallback to regex-based parsing
      return this.fallbackRegexParseContent(content);
    }
  }
  
  /**
   * Parse Python code using the Python AST parser script
   * @param filePath Path to the Python file
   * @returns Parsed result or null if parsing failed
   */
  private async parseWithLibCST(filePath: string): Promise<ICodeParserResult> {
    try {
      if (!fs.existsSync(filePath)) {
        throw new McpApplicationError(`File not found: ${filePath}`);
      }

      const result = await execFileAsync('python3', [this.pythonScriptPath, filePath], {
        maxBuffer: 1024 * 1024 * 10 // 10MB buffer
      });

      const jsonResult = JSON.parse(result.stdout) as LibCSTParserResult;
      
      return this.convertLibCSTResultToParserResult(jsonResult, filePath);
    } catch (error) {
      logger.error(`Error parsing Python file with LibCST: ${error}`);
      throw error;
    }
  }
  
  private async parseContentWithLibCST(content: string): Promise<ICodeParserResult> {
    try {
      if (!fs.existsSync(this.pythonScriptPath)) {
        throw new McpApplicationError(`LibCST parser script not found at ${this.pythonScriptPath}`);
      }

      const childProcess = execFileAsync('python3', [this.pythonScriptPath], {
        maxBuffer: 1024 * 1024 * 10 // 10MB buffer
      });

      // Write content to stdin of the Python process
      if (childProcess.child.stdin) {
        childProcess.child.stdin.write(content);
        childProcess.child.stdin.end();
      }

      const result = await childProcess;
      const jsonResult = JSON.parse(result.stdout) as LibCSTParserResult;
      
      return this.convertLibCSTResultToParserResult(jsonResult, 'content');
    } catch (error) {
      logger.error(`Error parsing Python content with LibCST: ${error}`);
      throw error;
    }
  }
  
  /**
   * Parse Python code using regex patterns (fallback method)
   * @param filePath Path to the Python file
   * @returns Parsed result with basic function calls
   */
  private fallbackRegexParse(filePath: string): ICodeParserResult {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return this.fallbackRegexParseContent(content, filePath);
    } catch (error) {
      logger.error(`Error in fallback regex parsing: ${error}`);
      return {
        id: CodeParserId.PYTHON,
        source: filePath,
        functionCalls: [],
        functionDefinitions: [],
        imports: [],
        errors: [`Fallback parsing failed: ${error}`],
        success: false
      };
    }
  }
  
  private fallbackRegexParseContent(content: string, source: string = 'content'): ICodeParserResult {
    try {
      // Basic regex for function calls: capture function name and attempt to get arguments
      const functionCallRegex = /(\w+(?:\.\w+)*)\s*\(([\s\S]*?)\)/g;
      const functionCalls: FunctionCall[] = [];
      let match;

      while ((match = functionCallRegex.exec(content)) !== null) {
        const [fullMatch, name, argsString] = match;
        const lineNumber = this.getLineNumber(content, match.index);
        
        // Basic argument parsing
        const args = this.parseArguments(argsString);

        functionCalls.push({
          name: name.split('.').pop() || name,
          qualifiedName: name,
          arguments: args,
          location: {
            line: lineNumber,
            column: this.getColumnNumber(content, match.index, lineNumber)
          },
          caller: ''
        });
      }

      // Basic regex for function definitions
      const functionDefRegex = /def\s+(\w+)\s*\(([\s\S]*?)\)(?:\s*->\s*([\s\S]*?))?\s*:/g;
      const functionDefinitions: FunctionDefinition[] = [];

      while ((match = functionDefRegex.exec(content)) !== null) {
        const [fullMatch, name, paramsString, returnType] = match;
        const lineNumber = this.getLineNumber(content, match.index);
        
        // Basic parameter parsing
        const parameters = this.parseParameters(paramsString);

        functionDefinitions.push({
          name,
          qualifiedName: name,
          parameters,
          returnAnnotation: returnType?.trim() || '',
          docstring: this.extractDocstring(content, match.index + fullMatch.length) || '',
          location: {
            line: lineNumber,
            column: this.getColumnNumber(content, match.index, lineNumber)
          },
          decorators: [],
          isMethod: false,
          isAsync: content.slice(Math.max(0, match.index - 6), match.index).includes('async')
        });
      }

      // Basic regex for imports
      const importRegex = /(?:from\s+([\w.]+)\s+)?import\s+([\w*,\s]+)(?:\s+as\s+([\w]+))?/g;
      const imports: ImportStatement[] = [];

      while ((match = importRegex.exec(content)) !== null) {
        const [_, fromModule, importNames, alias] = match;
        const lineNumber = this.getLineNumber(content, match.index);
        
        // Handle multiple imports on a single line
        const importList = importNames.split(',').map(n => n.trim());
        
        for (const name of importList) {
          if (!name) continue;
          
          imports.push({
            module: fromModule || '',
            name,
            alias: alias || '',
            location: {
              line: lineNumber,
              column: this.getColumnNumber(content, match.index, lineNumber)
            }
          });
        }
      }

      return {
        id: CodeParserId.PYTHON,
        source,
        functionCalls,
        functionDefinitions,
        imports,
        errors: [],
        success: true
      };
    } catch (error) {
      logger.error(`Error in fallback regex content parsing: ${error}`);
      return {
        id: CodeParserId.PYTHON,
        source,
        functionCalls: [],
        functionDefinitions: [],
        imports: [],
        errors: [`Fallback content parsing failed: ${error}`],
        success: false
      };
    }
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

  private getLineNumber(content: string, index: number): number {
    return (content.slice(0, index).match(/\n/g) || []).length + 1;
  }

  private getColumnNumber(content: string, index: number, lineNumber: number): number {
    const lines = content.slice(0, index).split('\n');
    return lines[lines.length - 1].length + 1;
  }

  private parseArguments(argsString: string): { positional: any[], keywords: Record<string, any> } {
    const result = {
      positional: [] as any[],
      keywords: {} as Record<string, any>
    };

    if (!argsString.trim()) {
      return result;
    }

    // Simple argument parser - doesn't handle nested structures fully
    let inString = false;
    let stringChar = '';
    let currentArg = '';
    let inParens = 0;
    let inBrackets = 0;
    let inBraces = 0;

    for (let i = 0; i < argsString.length; i++) {
      const char = argsString[i];
      
      // Handle strings
      if ((char === '"' || char === "'") && (i === 0 || argsString[i-1] !== '\\')) {
        if (inString && char === stringChar) {
          inString = false;
        } else if (!inString) {
          inString = true;
          stringChar = char;
        }
      }
      
      // Track nesting
      if (!inString) {
        if (char === '(') inParens++;
        else if (char === ')') inParens--;
        else if (char === '[') inBrackets++;
        else if (char === ']') inBrackets--;
        else if (char === '{') inBraces++;
        else if (char === '}') inBraces--;
      }
      
      // Process argument separators
      if (char === ',' && !inString && inParens === 0 && inBrackets === 0 && inBraces === 0) {
        this.addArgument(currentArg.trim(), result);
        currentArg = '';
      } else {
        currentArg += char;
      }
    }
    
    // Add the last argument
    if (currentArg.trim()) {
      this.addArgument(currentArg.trim(), result);
    }

    return result;
  }

  private addArgument(arg: string, result: { positional: any[], keywords: Record<string, any> }) {
    // Check if it's a keyword argument
    const keywordMatch = arg.match(/^(\w+)\s*=\s*(.*)/);
    if (keywordMatch) {
      const [_, key, value] = keywordMatch;
      result.keywords[key] = this.parseValue(value);
    } else {
      result.positional.push(this.parseValue(arg));
    }
  }

  private parseValue(value: string): any {
    // Simple value parser - handles strings, numbers, and some literals
    value = value.trim();
    
    // String
    if ((value.startsWith('"') && value.endsWith('"')) || 
        (value.startsWith("'") && value.endsWith("'"))) {
      return value.slice(1, -1);
    }
    
    // Number
    if (!isNaN(Number(value))) {
      return Number(value);
    }
    
    // Boolean
    if (value === 'True') return true;
    if (value === 'False') return false;
    if (value === 'None') return null;
    
    // Default to string representation
    return value;
  }

  private parseParameters(paramsString: string): { name: string, annotation: string, defaultValue: string, isKeywordOnly: boolean, isPositionalOnly: boolean, isVariadic: boolean }[] {
    const params = [];
    if (!paramsString.trim()) return params;
    
    // Split by commas, but respect nesting
    const paramList = this.splitRespectingNesting(paramsString);
    
    let seenStarParam = false;
    
    for (const param of paramList) {
      const trimmed = param.trim();
      if (!trimmed) continue;
      
      // Handle special parameter markers
      if (trimmed === '*') {
        seenStarParam = true;
        continue;
      }
      
      const isVariadic = trimmed.startsWith('*');
      const isKeywordVariadic = trimmed.startsWith('**');
      const isKeywordOnly = seenStarParam && !isVariadic && !isKeywordVariadic;
      
      // Remove * or ** prefix
      let paramName = isVariadic ? 
        (isKeywordVariadic ? trimmed.substring(2) : trimmed.substring(1)) : 
        trimmed;
      
      // Handle type annotations and defaults
      let annotation = '';
      let defaultValue = '';
      
      // Check for type annotation
      const annotationMatch = paramName.match(/(.*?)\s*:\s*(.*?)(?:\s*=\s*(.*))?$/);
      if (annotationMatch) {
        paramName = annotationMatch[1];
        annotation = annotationMatch[2];
        defaultValue = annotationMatch[3] || '';
      } else {
        // Check for default value without annotation
        const defaultMatch = paramName.match(/(.*?)\s*=\s*(.*)$/);
        if (defaultMatch) {
          paramName = defaultMatch[1];
          defaultValue = defaultMatch[2];
        }
      }
      
      params.push({
        name: paramName,
        annotation,
        defaultValue,
        isKeywordOnly,
        isPositionalOnly: false, // Python 3.8+ feature, not easily detected with regex
        isVariadic: isVariadic || isKeywordVariadic
      });
    }
    
    return params;
  }

  private splitRespectingNesting(str: string): string[] {
    const result = [];
    let current = '';
    let inString = false;
    let stringChar = '';
    let inParens = 0;
    let inBrackets = 0;
    let inBraces = 0;
    
    for (let i = 0; i < str.length; i++) {
      const char = str[i];
      
      // Handle strings
      if ((char === '"' || char === "'") && (i === 0 || str[i-1] !== '\\')) {
        if (inString && char === stringChar) {
          inString = false;
        } else if (!inString) {
          inString = true;
          stringChar = char;
        }
      }
      
      // Track nesting
      if (!inString) {
        if (char === '(') inParens++;
        else if (char === ')') inParens--;
        else if (char === '[') inBrackets++;
        else if (char === ']') inBrackets--;
        else if (char === '{') inBraces++;
        else if (char === '}') inBraces--;
      }
      
      // Process separators
      if (char === ',' && !inString && inParens === 0 && inBrackets === 0 && inBraces === 0) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    
    if (current) {
      result.push(current);
    }
    
    return result;
  }

  private extractDocstring(content: string, startIndex: number): string {
    // Extract docstring after function definition
    // Skip whitespace and newlines
    let i = startIndex;
    while (i < content.length && /\s/.test(content[i])) i++;
    
    // Check for docstring
    if (i < content.length) {
      const tripleSingleQuote = content.slice(i).startsWith("'''");
      const tripleDoubleQuote = content.slice(i).startsWith('"""');
      
      if (tripleSingleQuote || tripleDoubleQuote) {
        const quoteType = tripleSingleQuote ? "'''" : '"""';
        i += 3; // Skip opening quotes
        
        const endIndex = content.indexOf(quoteType, i);
        if (endIndex !== -1) {
          return content.slice(i, endIndex).trim();
        }
      }
    }
    
    return '';
  }

  private convertLibCSTResultToParserResult(libcstResult: LibCSTParserResult, source: string): ICodeParserResult {
    const functionCalls: FunctionCall[] = libcstResult.function_calls.map(call => ({
      name: call.name,
      qualifiedName: call.qualified_name,
      arguments: call.arguments,
      location: call.location ? {
        line: call.location.line,
        column: call.location.column
      } : undefined,
      caller: call.caller
    }));

    const functionDefinitions: FunctionDefinition[] = libcstResult.function_definitions.map(def => ({
      name: def.name,
      qualifiedName: def.qualified_name,
      parameters: def.parameters.map(param => ({
        name: param.name,
        annotation: param.annotation,
        defaultValue: param.default_value,
        isKeywordOnly: param.is_keyword_only,
        isPositionalOnly: param.is_positional_only,
        isVariadic: param.is_variadic
      })),
      returnAnnotation: def.return_annotation,
      docstring: def.docstring,
      location: def.location ? {
        line: def.location.line,
        column: def.location.column
      } : undefined,
      decorators: def.decorators,
      isMethod: def.is_method,
      isAsync: def.is_async
    }));

    const imports: ImportStatement[] = libcstResult.imports.map(imp => ({
      module: imp.module,
      name: imp.name,
      alias: imp.alias,
      location: imp.location ? {
        line: imp.location.line,
        column: imp.location.column
      } : undefined
    }));

    return {
      id: CodeParserId.PYTHON,
      source,
      functionCalls,
      functionDefinitions,
      imports,
      errors: libcstResult.errors,
      success: libcstResult.errors.length === 0
    };
  }
} 