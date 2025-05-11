/**
 * Code parser module for extracting function calls and relationships from code files.
 * This module provides a unified interface for parsing different programming languages
 * and a factory system for registering language-specific parsers.
 */

// Export public interfaces
export * from './types';
export * from './baseParser';
export * from './parserFactory';
export * from './service';

// Import language parsers
import { PythonCodeParser } from './languages/python';
import { MatlabCodeParser } from './languages/matlab';

import { CodeParserService } from './service';
import { SupportedLanguage } from './types';

/**
 * Create and initialize the code parser service with all available parsers
 * @returns Initialized CodeParserService
 */
export function createCodeParserService(): CodeParserService {
  const service = new CodeParserService();
  
  // Register all available parsers
  service.registerParser(new PythonCodeParser());
  service.registerParser(new MatlabCodeParser());
  
  return service;
}

// Export a default instance for convenience
const codeParserService = new CodeParserService();
export default codeParserService; 