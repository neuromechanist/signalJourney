/**
 * Abstract base parser implementation providing common functionality
 * for all language-specific parsers.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

import logger from '@/utils/logger';
import { McpApplicationError } from '@/core/mcp-types';
import { TraversedFile } from '../repositoryScanner.service';
import { 
  ICodeParser, 
  ICodeParserResult, 
  IFunctionCall,
  IFunctionDefinition,
  IParserOptions,
  SupportedLanguage
} from './types';

/**
 * Abstract base class that provides common functionality for all parsers
 */
export abstract class BaseCodeParser implements ICodeParser {
  /**
   * Constructor for the base parser
   * @param language The language this parser supports
   */
  constructor(protected language: SupportedLanguage) {}

  /**
   * Get the supported language for this parser
   */
  public getSupportedLanguage(): SupportedLanguage {
    return this.language;
  }

  /**
   * Parse a code file and extract function calls and other relevant information
   * @param file The file to parse, either as a TraversedFile or a file path
   * @param options Parsing options to control the extraction process
   * @returns Parsed code information
   */
  public async parseFile(file: TraversedFile | string, options?: IParserOptions): Promise<ICodeParserResult> {
    try {
      // Determine the file path based on the input type
      const filePath = typeof file === 'string' ? file : file.path;
      
      // Get the content of the file
      const content = await this.readFileContent(filePath);
      
      // Determine the language based on file extension if not specified
      const detectedLanguage = typeof file === 'string' 
        ? this.detectLanguageFromPath(filePath) 
        : this.detectLanguageFromFile(file);
      
      // Verify that this parser supports the detected language
      if (detectedLanguage !== this.language) {
        logger.warn(`File language (${detectedLanguage}) doesn't match parser language (${this.language})`);
        // Still attempt to parse, but with a warning
      }
      
      // Parse the content
      return this.parseContent(content, detectedLanguage, options);
    } catch (error: any) {
      const errorMessage = `Failed to parse file: ${error.message}`;
      logger.error(errorMessage, { error });
      
      // Return a partial result with error information instead of throwing
      return {
        filePath: typeof file === 'string' ? file : file.path,
        language: this.language,
        functionCalls: [],
        functionDefinitions: [],
        imports: [],
        dependencies: [],
        parseErrors: [errorMessage]
      };
    }
  }

  /**
   * Parse raw code content directly (without a file)
   * This method must be implemented by language-specific subclasses
   */
  public abstract parseContent(
    content: string, 
    language: SupportedLanguage, 
    options?: IParserOptions
  ): Promise<ICodeParserResult>;

  /**
   * Generate a unique ID for a function call or definition
   * @param name Function name
   * @param filePath File path
   * @param line Line number
   * @param column Column number (optional)
   * @returns Unique ID
   */
  protected generateFunctionId(
    name: string, 
    filePath: string, 
    line: number, 
    column?: number
  ): string {
    const idString = `${name}:${filePath}:${line}${column ? `:${column}` : ''}`;
    return crypto.createHash('md5').update(idString).digest('hex').substring(0, 12);
  }
  
  /**
   * Read the content of a file
   * @param filePath Path to the file
   * @returns File content as string
   */
  protected async readFileContent(filePath: string): Promise<string> {
    try {
      return await fs.promises.readFile(filePath, 'utf-8');
    } catch (error: any) {
      throw new McpApplicationError(
        `Failed to read file ${filePath}: ${error.message}`,
        'FILE_READ_ERROR'
      );
    }
  }

  /**
   * Detect the language of a file based on its extension
   * @param filePath Path to the file
   * @returns Detected language
   */
  protected detectLanguageFromPath(filePath: string): SupportedLanguage {
    const ext = path.extname(filePath).toLowerCase();
    
    if (ext === '.py') {
      return SupportedLanguage.PYTHON;
    } else if (ext === '.m') {
      return SupportedLanguage.MATLAB;
    }
    
    return SupportedLanguage.UNKNOWN;
  }
  
  /**
   * Detect the language of a file based on TraversedFile metadata
   * @param file TraversedFile object
   * @returns Detected language
   */
  protected detectLanguageFromFile(file: TraversedFile): SupportedLanguage {
    return this.detectLanguageFromPath(file.path);
  }
  
  /**
   * Create a minimal result object with default values
   * @param filePath Path to the file
   * @returns A minimal ICodeParserResult object
   */
  protected createMinimalResult(filePath: string): ICodeParserResult {
    return {
      filePath,
      language: this.language,
      functionCalls: [],
      functionDefinitions: [],
      imports: [],
      dependencies: [],
    };
  }
} 