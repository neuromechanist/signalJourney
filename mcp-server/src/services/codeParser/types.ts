/**
 * Core types and interfaces for the code parser architecture.
 * These definitions establish the framework for parsing different programming languages
 * and extracting structured information about function calls and their relationships.
 */

import { TraversedFile } from '../repositoryScanner.service';

/**
 * Represents a parameter in a function call
 */
export interface IFunctionParameter {
  name?: string;                // Parameter name (may be undefined for positional params)
  value?: string;               // String representation of the parameter value
  position: number;             // Position in the parameter list (0-based)
  isNamed: boolean;             // Whether this is a named parameter
  isDefault?: boolean;          // Whether this parameter appears to be using a default value
  inferredType?: string;        // Best guess at the parameter type
}

/**
 * Represents a function call extracted from code
 */
export interface IFunctionCall {
  id: string;                   // Unique identifier for this function call
  name: string;                 // Name of the called function
  fullyQualifiedName?: string;  // Namespace-qualified name if available
  lineNumber: number;           // Line where the function call appears
  columnNumber?: number;        // Column where the function call starts (if available)
  filePath: string;             // Path to the file containing this call
  parameters: IFunctionParameter[]; // Parameters passed to the function
  sourceCode?: string;          // The original source code for this function call
  parentFunctionId?: string;    // ID of the containing function (if this call is nested)
  calleeFunction?: string;      // ID or name of the function being called
  confidence: number;           // Confidence score (0-1) of the extraction accuracy
}

/**
 * Represents a defined function in the code (not just a call)
 */
export interface IFunctionDefinition {
  id: string;                   // Unique identifier for this function definition
  name: string;                 // Name of the function
  filePath: string;             // Path to the file containing this definition
  lineStart: number;            // Starting line of the function
  lineEnd: number;              // Ending line of the function
  parameters: IFunctionParameter[]; // Parameters accepted by the function
  returnType?: string;          // Return type if available
  returnValue?: string;         // Return value pattern if extractable
  documentation?: string;       // Associated documentation/comments if available
  body?: string;                // Function body code (may be omitted for large functions)
}

/**
 * Represents the result of parsing a code file
 */
export interface ICodeParserResult {
  filePath: string;             // Path to the parsed file
  language: string;             // Detected language
  functionCalls: IFunctionCall[]; // Extracted function calls
  functionDefinitions: IFunctionDefinition[]; // Extracted function definitions
  imports: string[];            // Import statements in the file
  dependencies: string[];       // Files this file depends on
  hasMainGuard?: boolean;       // Whether the file has a main guard (e.g., if __name__ == "__main__")
  parseErrors?: string[];       // Any errors encountered during parsing
  metadata?: Record<string, any>; // Additional language-specific metadata
}

/**
 * Supported programming languages for parsing
 */
export enum SupportedLanguage {
  PYTHON = 'python',
  MATLAB = 'matlab',
  UNKNOWN = 'unknown'
}

/**
 * Options for controlling the parsing process
 */
export interface IParserOptions {
  extractComments?: boolean;    // Whether to extract comments
  maxDepth?: number;            // Maximum depth for nested function calls
  includeSourceCode?: boolean;  // Whether to include the source code snippets
  analyzeFunctionBodies?: boolean; // Whether to analyze function bodies in detail
  parserSpecificOptions?: Record<string, any>; // Options specific to a particular parser
}

/**
 * Core interface that all language-specific parsers must implement
 */
export interface ICodeParser {
  /**
   * Parse a code file and extract function calls and other relevant information
   * @param file The file to parse, either as a TraversedFile or a file path
   * @param options Parsing options to control the extraction process
   * @returns Parsed code information in a standardized format
   */
  parseFile(file: TraversedFile | string, options?: IParserOptions): Promise<ICodeParserResult>;
  
  /**
   * Parse raw code content directly (without a file)
   * @param content The code content to parse
   * @param language The language of the code content
   * @param options Parsing options to control the extraction process
   * @returns Parsed code information in a standardized format
   */
  parseContent(content: string, language: SupportedLanguage, options?: IParserOptions): Promise<ICodeParserResult>;
  
  /**
   * Get the supported language for this parser
   * @returns The language this parser supports
   */
  getSupportedLanguage(): SupportedLanguage;
} 