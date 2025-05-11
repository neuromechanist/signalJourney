/**
 * Main service for code parsing operations.
 * Coordinates parsing operations and provides a unified interface
 * for the rest of the application.
 */

import * as fs from 'fs';
import * as path from 'path';

import logger from '@/utils/logger';
import { McpApplicationError } from '@/core/mcp-types';
import { TraversedFile } from '../repositoryScanner.service';
import { CodeParserFactory } from './parserFactory';
import {
  ICodeParser,
  ICodeParserResult,
  IParserOptions,
  SupportedLanguage
} from './types';
import { ParserOutputNormalizer } from './normalizer';

/**
 * Service for parsing code files
 */
export class CodeParserService {
  private factory: CodeParserFactory;
  private normalizer: ParserOutputNormalizer;
  
  /**
   * Constructor
   */
  constructor() {
    this.factory = CodeParserFactory.getInstance();
    this.normalizer = new ParserOutputNormalizer();
    logger.debug('CodeParserService initialized');
  }
  
  /**
   * Register a parser implementation
   * @param parser The parser to register
   */
  public registerParser(parser: ICodeParser): void {
    this.factory.registerParser(parser);
  }
  
  /**
   * Parse a single file
   * @param file The file to parse (TraversedFile or path)
   * @param options Parsing options
   * @returns Parsed code information
   */
  public async parseFile(
    file: TraversedFile | string, 
    options?: IParserOptions
  ): Promise<ICodeParserResult> {
    const filePath = typeof file === 'string' ? file : file.path;
    
    try {
      // Get the appropriate parser based on the file extension
      const parser = this.factory.getParserForFile(filePath);
      const language = parser.getSupportedLanguage();
      
      // Parse the file using the selected parser
      const result = await parser.parseFile(file, options);
      
      // Normalize the output
      return this.normalizer.normalizeResult(
        result, 
        language, 
        parser.constructor.name
      );
    } catch (error: any) {
      if (error.code === 'PARSER_NOT_FOUND' || error.code === 'UNSUPPORTED_LANGUAGE') {
        // For known errors about unsupported languages, return a minimal result
        const language = path.extname(filePath).slice(1);
        
        logger.info(`No parser available for ${filePath} (${language})`);
        
        return {
          filePath,
          language,
          functionCalls: [],
          functionDefinitions: [],
          imports: [],
          dependencies: [],
          parseErrors: [`Language ${language} is not supported`]
        };
      }
      
      // For other errors, rethrow
      throw error;
    }
  }
  
  /**
   * Parse a directory of files
   * @param directoryPath Path to the directory
   * @param options Parsing options
   * @param fileFilter Optional filter function to select files
   * @returns An array of parsing results
   */
  public async parseDirectory(
    directoryPath: string,
    options?: IParserOptions,
    fileFilter?: (filePath: string) => boolean
  ): Promise<ICodeParserResult[]> {
    if (!fs.existsSync(directoryPath)) {
      throw new McpApplicationError(
        `Directory does not exist: ${directoryPath}`,
        'DIRECTORY_NOT_FOUND'
      );
    }
    
    const stats = await fs.promises.stat(directoryPath);
    if (!stats.isDirectory()) {
      throw new McpApplicationError(
        `Path is not a directory: ${directoryPath}`,
        'INVALID_DIRECTORY'
      );
    }
    
    // Get all files in the directory (recursively)
    const files = await this.getFilesRecursively(directoryPath);
    
    // Apply filter if provided
    const filteredFiles = fileFilter
      ? files.filter((file) => fileFilter(file))
      : files;
    
    // Parse each file and collect results
    const results: ICodeParserResult[] = [];
    
    for (const file of filteredFiles) {
      try {
        const result = await this.parseFile(file, options);
        results.push(result);
      } catch (error: any) {
        logger.error(`Error parsing file ${file}:`, error);
        // Continue with next file instead of failing the entire directory
      }
    }
    
    return results;
  }
  
  /**
   * Parse a collection of files from a repository scan
   * @param files Array of traversed files
   * @param options Parsing options
   * @returns An array of parsing results
   */
  public async parseTraversedFiles(
    files: TraversedFile[],
    options?: IParserOptions
  ): Promise<ICodeParserResult[]> {
    const results: ICodeParserResult[] = [];
    
    // Filter for non-directory files first
    const filesToParse = files.filter(file => file.isFile && !file.isDirectory);
    
    for (const file of filesToParse) {
      try {
        // Try to get a parser for this file extension
        const ext = path.extname(file.path).toLowerCase();
        
        if (ext === '.py' || ext === '.m') {
          // Only attempt to parse supported file types
          const result = await this.parseFile(file, options);
          results.push(result);
        }
      } catch (error: any) {
        logger.error(`Error parsing traversed file ${file.path}:`, error);
        // Continue with next file
      }
    }
    
    return results;
  }
  
  /**
   * Parse code content directly
   * @param content The code content
   * @param language The language of the content
   * @param options Parsing options
   * @returns Parsed code information
   */
  public async parseContent(
    content: string,
    language: SupportedLanguage,
    options?: IParserOptions
  ): Promise<ICodeParserResult> {
    try {
      const parser = this.factory.getParser(language);
      const result = await parser.parseContent(content, language, options);
      
      // Normalize the output
      return this.normalizer.normalizeResult(
        result, 
        language, 
        parser.constructor.name
      );
    } catch (error: any) {
      if (error.code === 'PARSER_NOT_FOUND') {
        // No parser available for this language
        return {
          filePath: '<content>',
          language: language,
          functionCalls: [],
          functionDefinitions: [],
          imports: [],
          dependencies: [],
          parseErrors: [`Language ${language} is not supported`]
        };
      }
      
      throw error;
    }
  }
  
  /**
   * Get a list of all supported languages
   * @returns Array of supported languages
   */
  public getSupportedLanguages(): SupportedLanguage[] {
    return this.factory.getSupportedLanguages();
  }
  
  /**
   * Recursively get all files in a directory
   * @param dirPath Directory path
   * @returns Array of file paths
   */
  private async getFilesRecursively(dirPath: string): Promise<string[]> {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    
    const files = await Promise.all(
      entries.map(async (entry) => {
        const entryPath = path.join(dirPath, entry.name);
        
        if (entry.isDirectory()) {
          return this.getFilesRecursively(entryPath);
        } else {
          return [entryPath];
        }
      })
    );
    
    // Flatten the array of arrays into a single array
    return files.flat();
  }
} 