/**
 * MATLAB code parser implementation.
 * Parses MATLAB code to extract function calls, definitions, and relationships.
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { ICodeParser, ICodeParserResult, CodeParserOptions, FunctionCall, FunctionDefinition, ImportStatement } from '../../types';
import { BaseCodeParser } from '../../baseParser';
import { CodeParserId } from '../../parserFactory';
import { Logger } from '../../../../utils/logger';

const logger = new Logger('MatlabParser');
const execFileAsync = promisify(execFile);

interface TreeSitterParserResult {
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
    };
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
    outputs: string[];
    return_annotation: string;
    docstring: string;
    location: {
      line: number;
      column: number;
    };
    decorators: string[];
    is_method: boolean;
    is_async: boolean;
  }[];
  imports: any[];
  errors: string[];
}

export class MatlabParser extends BaseCodeParser implements ICodeParser {
  private parserPath: string;
  
  constructor() {
    super();
    this.parserPath = path.join(__dirname, 'matlab-parser.js');
  }

  public async parseFile(filePath: string, options: CodeParserOptions = {}): Promise<ICodeParserResult> {
    if (!filePath.endsWith('.m')) {
      throw new Error('File is not a MATLAB file');
    }

    try {
      return await this.parseWithTreeSitter(filePath);
    } catch (error) {
      logger.warn(`Failed to parse with tree-sitter-matlab: ${error}. Falling back to regex parser.`);
      // Fallback to regex-based parsing
      return this.fallbackRegexParse(filePath);
    }
  }

  public async parseContent(content: string, options: CodeParserOptions = {}): Promise<ICodeParserResult> {
    try {
      return await this.parseContentWithTreeSitter(content);
    } catch (error) {
      logger.warn(`Failed to parse content with tree-sitter-matlab: ${error}. Falling back to regex parser.`);
      // Fallback to regex-based parsing
      return this.fallbackRegexParseContent(content);
    }
  }

  private async parseWithTreeSitter(filePath: string): Promise<ICodeParserResult> {
    try {
      if (!fs.existsSync(this.parserPath)) {
        throw new Error(`MATLAB parser script not found at ${this.parserPath}`);
      }

      const result = await execFileAsync('node', [this.parserPath, filePath], {
        maxBuffer: 1024 * 1024 * 10 // 10MB buffer
      });

      const jsonResult = JSON.parse(result.stdout) as TreeSitterParserResult;
      
      return this.convertTreeSitterResultToParserResult(jsonResult, filePath);
    } catch (error) {
      logger.error(`Error parsing MATLAB file with tree-sitter: ${error}`);
      throw error;
    }
  }

  private async parseContentWithTreeSitter(content: string): Promise<ICodeParserResult> {
    try {
      if (!fs.existsSync(this.parserPath)) {
        throw new Error(`MATLAB parser script not found at ${this.parserPath}`);
      }

      const childProcess = spawn('node', [this.parserPath]);
      let stdout = '';
      let stderr = '';

      childProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      childProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      // Send content to the parser process
      childProcess.stdin.write(content);
      childProcess.stdin.end();

      // Wait for the process to complete
      const exitCode = await new Promise<number>((resolve) => {
        childProcess.on('close', resolve);
      });

      if (exitCode !== 0) {
        throw new Error(`MATLAB parser exited with code ${exitCode}: ${stderr}`);
      }

      const jsonResult = JSON.parse(stdout) as TreeSitterParserResult;
      
      return this.convertTreeSitterResultToParserResult(jsonResult, 'content');
    } catch (error) {
      logger.error(`Error parsing MATLAB content with tree-sitter: ${error}`);
      throw error;
    }
  }

  private convertTreeSitterResultToParserResult(treeSitterResult: TreeSitterParserResult, source: string): ICodeParserResult {
    const functionCalls: FunctionCall[] = treeSitterResult.function_calls.map(call => ({
      name: call.name,
      qualifiedName: call.qualified_name,
      arguments: {
        positional: call.arguments.positional,
        keywords: call.arguments.keywords
      },
      location: call.location ? {
        line: call.location.line,
        column: call.location.column
      } : undefined,
      caller: call.caller
    }));

    const functionDefinitions: FunctionDefinition[] = treeSitterResult.function_definitions.map(def => ({
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
      // Add outputs to the returnAnnotation for MATLAB
      returnAnnotation: def.outputs && def.outputs.length ? `[${def.outputs.join(', ')}]` : '',
      docstring: def.docstring,
      location: def.location ? {
        line: def.location.line,
        column: def.location.column
      } : undefined,
      decorators: def.decorators,
      isMethod: def.is_method,
      isAsync: def.is_async
    }));

    // MATLAB doesn't really have imports in the same way as Python
    const imports: ImportStatement[] = [];

    return {
      id: CodeParserId.MATLAB,
      source,
      functionCalls,
      functionDefinitions,
      imports,
      errors: treeSitterResult.errors,
      success: treeSitterResult.errors.length === 0
    };
  }

  // Fallback parser implementation using regex for when tree-sitter fails
  private fallbackRegexParse(filePath: string): ICodeParserResult {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return this.fallbackRegexParseContent(content, filePath);
    } catch (error) {
      logger.error(`Error in fallback regex parsing: ${error}`);
      return {
        id: CodeParserId.MATLAB,
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
      const functionCalls: FunctionCall[] = [];
      const functionDefinitions: FunctionDefinition[] = [];
      const lines = content.split('\n');
      
      // Process the code line by line
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // Skip comments and empty lines
        if (line.trim().startsWith('%') || !line.trim()) {
          continue;
        }
        
        // Extract function calls using parentheses syntax
        const functionCallRegex = /(\w+(?:\.\w+)*)\s*\((.*?)\)/g;
        let match;
        while ((match = functionCallRegex.exec(line)) !== null) {
          const [_, name, argsString] = match;
          const args = this.parseArguments(argsString);
          
          functionCalls.push({
            name,
            qualifiedName: name,
            arguments: args,
            location: {
              line: i + 1,
              column: match.index + 1
            },
            caller: ''
          });
        }
        
        // Extract command form function calls (no parentheses)
        // This is a simplified approach and may miss some cases
        const commandCallRegex = /^\s*(\w+)(\s+[^;%]+)?/;
        const commandMatch = commandCallRegex.exec(line);
        if (commandMatch && !line.includes('=') && !line.includes('function') && !functionCallRegex.test(line)) {
          const [_, name, argsString] = commandMatch;
          const args = argsString ? { positional: argsString.trim().split(/\s+/), keywords: {} } : { positional: [], keywords: {} };
          
          functionCalls.push({
            name,
            qualifiedName: name,
            arguments: args,
            location: {
              line: i + 1,
              column: commandMatch.index + 1
            },
            caller: ''
          });
        }
        
        // Extract function definitions
        const functionDefRegex = /^\s*function\s+(?:\[(.*?)\]\s*=\s*)?(\w+)\s*\((.*?)\)/;
        const functionDefMatch = functionDefRegex.exec(line);
        if (functionDefMatch) {
          const [_, outputsString, name, paramsString] = functionDefMatch;
          const parameters = paramsString.split(',').map(param => ({
            name: param.trim(),
            annotation: '',
            defaultValue: '',
            isKeywordOnly: false,
            isPositionalOnly: true,
            isVariadic: false
          }));
          
          // Extract docstring from following comment lines
          let docstring = '';
          let j = i + 1;
          while (j < lines.length && (lines[j].trim().startsWith('%') || !lines[j].trim())) {
            if (lines[j].trim().startsWith('%')) {
              docstring += (docstring ? '\n' : '') + lines[j].trim().substring(1).trim();
            }
            j++;
          }
          
          functionDefinitions.push({
            name,
            qualifiedName: name,
            parameters,
            returnAnnotation: outputsString ? `[${outputsString}]` : '',
            docstring,
            location: {
              line: i + 1,
              column: line.indexOf('function') + 1
            },
            decorators: [],
            isMethod: false,
            isAsync: false
          });
        }
      }
      
      return {
        id: CodeParserId.MATLAB,
        source,
        functionCalls,
        functionDefinitions,
        imports: [],
        errors: [],
        success: true
      };
    } catch (error) {
      logger.error(`Error in fallback regex content parsing: ${error}`);
      return {
        id: CodeParserId.MATLAB,
        source,
        functionCalls: [],
        functionDefinitions: [],
        imports: [],
        errors: [`Fallback content parsing failed: ${error}`],
        success: false
      };
    }
  }
  
  private parseArguments(argsString: string): { positional: any[], keywords: Record<string, any> } {
    const result = {
      positional: [] as any[],
      keywords: {} as Record<string, any>
    };
    
    if (!argsString.trim()) {
      return result;
    }
    
    // Split the arguments by commas, respecting nested structures
    const args = this.splitRespectingNesting(argsString);
    
    // MATLAB has a special name-value pair syntax for parameter passing
    // We'll assume that any string followed by another argument is a potential parameter name
    for (let i = 0; i < args.length; i++) {
      const arg = args[i].trim();
      
      // Check if this could be a name-value pair
      if (i < args.length - 1 && (arg.startsWith("'") && arg.endsWith("'") || arg.startsWith('"') && arg.endsWith('"'))) {
        const paramName = arg.slice(1, -1); // Remove quotes
        // Only treat as parameter name if it's a valid identifier
        if (/^[a-zA-Z][a-zA-Z0-9_]*$/.test(paramName)) {
          result.keywords[paramName] = args[i + 1];
          i++; // Skip the value as we've processed it
          continue;
        }
      }
      
      // Regular positional argument
      result.positional.push(arg);
    }
    
    return result;
  }
  
  private splitRespectingNesting(str: string): string[] {
    const result: string[] = [];
    let start = 0;
    let parenCount = 0;
    let bracketCount = 0;
    let braceCount = 0;
    let inString = false;
    let stringChar = '';
    
    for (let i = 0; i < str.length; i++) {
      const char = str[i];
      
      // Handle string literals
      if ((char === "'" || char === '"') && (i === 0 || str[i - 1] !== '\\')) {
        if (!inString) {
          inString = true;
          stringChar = char;
        } else if (char === stringChar) {
          inString = false;
        }
      }
      
      // Skip nesting tracking if in a string
      if (!inString) {
        if (char === '(') parenCount++;
        else if (char === ')') parenCount--;
        else if (char === '[') bracketCount++;
        else if (char === ']') bracketCount--;
        else if (char === '{') braceCount++;
        else if (char === '}') braceCount--;
      }
      
      // If we're at a top-level comma, split the argument
      if (char === ',' && parenCount === 0 && bracketCount === 0 && braceCount === 0 && !inString) {
        result.push(str.substring(start, i).trim());
        start = i + 1;
      }
    }
    
    // Add the last argument
    if (start < str.length) {
      result.push(str.substring(start).trim());
    }
    
    return result;
  }
} 