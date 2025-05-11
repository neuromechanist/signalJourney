/**
 * Factory for creating and managing code parser instances.
 * Provides registration and lookup of language-specific parsers.
 */

import * as path from 'path';

import logger from '@/utils/logger';
import { ICodeParser, SupportedLanguage } from './types';
import { McpApplicationError } from '@/core/mcp-types';
import { PythonParser } from './languages/python';
import { MatlabParser } from './languages/matlab';

/**
 * Singleton factory for managing code parser implementations
 */
export class CodeParserFactory {
  private static instance: CodeParserFactory;
  private parsers: Map<SupportedLanguage, ICodeParser>;
  
  /**
   * Private constructor to enforce singleton pattern
   */
  private constructor() {
    this.parsers = new Map<SupportedLanguage, ICodeParser>();
    logger.debug('CodeParserFactory initialized');

    // Initialize the default parsers
    this.registerParser(new PythonParser());
    this.registerParser(new MatlabParser());
  }
  
  /**
   * Get the singleton instance of the factory
   * @returns The factory instance
   */
  public static getInstance(): CodeParserFactory {
    if (!CodeParserFactory.instance) {
      CodeParserFactory.instance = new CodeParserFactory();
    }
    return CodeParserFactory.instance;
  }
  
  /**
   * Register a parser for a specific language
   * @param parser The parser implementation
   * @returns This factory instance for chaining
   */
  public registerParser(parser: ICodeParser): CodeParserFactory {
    const language = parser.getSupportedLanguage();
    
    if (this.parsers.has(language)) {
      logger.warn(`Overriding existing parser for language: ${language}`);
    }
    
    this.parsers.set(language, parser);
    logger.info(`Registered parser for language: ${language}`);
    return this;
  }
  
  /**
   * Get a parser instance for a specific language
   * @param language The language to get a parser for
   * @returns The appropriate parser instance
   */
  public getParser(language: SupportedLanguage): ICodeParser {
    const parser = this.parsers.get(language);
    
    if (!parser) {
      throw new McpApplicationError(
        `No parser registered for language: ${language}`,
        'PARSER_NOT_FOUND'
      );
    }
    
    return parser;
  }
  
  /**
   * Get the appropriate parser for a file based on its extension
   * @param filePath Path to the file
   * @returns The appropriate parser instance
   */
  public getParserForFile(filePath: string): ICodeParser {
    const ext = path.extname(filePath).toLowerCase();
    let language: SupportedLanguage;
    
    if (ext === '.py') {
      language = SupportedLanguage.PYTHON;
    } else if (ext === '.m') {
      language = SupportedLanguage.MATLAB;
    } else {
      throw new McpApplicationError(
        `Unsupported file extension: ${ext}`,
        'UNSUPPORTED_LANGUAGE'
      );
    }
    
    return this.getParser(language);
  }
  
  /**
   * Check if a parser is registered for a specific language
   * @param language The language to check
   * @returns True if a parser is registered, false otherwise
   */
  public hasParser(language: SupportedLanguage): boolean {
    return this.parsers.has(language);
  }
  
  /**
   * Get all supported languages
   * @returns Array of supported languages
   */
  public getSupportedLanguages(): SupportedLanguage[] {
    return Array.from(this.parsers.keys());
  }
} 