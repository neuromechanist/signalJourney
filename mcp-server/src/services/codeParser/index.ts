/**
 * Code Parser module index.
 * Exports all code parsing functionality.
 */

// Export main parser service
export { CodeParserService } from './service';

// Export factory
export { CodeParserFactory } from './parserFactory';

// Export base parser
export { BaseCodeParser } from './baseParser';

// Export normalizer
export { ParserOutputNormalizer } from './normalizer';

// Export individual language parsers
export { PythonParser } from './languages/python';
export { MatlabParser } from './languages/matlab';

// Export types and interfaces
export {
  ICodeParser,
  ICodeParserResult,
  IFunctionCall,
  IFunctionDefinition,
  IFunctionParameter,
  IImport,
  IVariable,
  IParserOptions,
  ISourceLocation,
  SupportedLanguage,
  ParameterStyle
} from './types';

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