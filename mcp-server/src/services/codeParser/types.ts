/**
 * Core types and interfaces for the code parser architecture.
 * These definitions establish the framework for parsing different programming languages
 * and extracting structured information about function calls and their relationships.
 */

import { TraversedFile } from '../repositoryScanner.service';

/**
 * Supported programming languages for parsing
 */
export enum SupportedLanguage {
  PYTHON = 'python',
  MATLAB = 'matlab',
  UNKNOWN = 'unknown'
}

/**
 * Parameter passing style in different languages
 */
export enum ParameterStyle {
  POSITIONAL = 'positional',       // Regular positional parameter
  NAMED = 'named',                 // Named parameter (name=value)
  KEYWORD_ONLY = 'keyword_only',   // Python keyword-only parameter (after *)
  POSITIONAL_ONLY = 'positional_only', // Python positional-only parameter (before /)
  VARIADIC_POSITIONAL = 'variadic_positional', // Python *args
  VARIADIC_KEYWORD = 'variadic_keyword',   // Python **kwargs
  NAME_VALUE_PAIR = 'name_value_pair',     // MATLAB name-value pair
  MATLAB_VARARG = 'matlab_vararg'          // MATLAB varargin
}

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
  style?: ParameterStyle;       // The parameter style/convention used
  annotation?: string;          // Type annotation or hint if available
  defaultValue?: string;        // Default value for the parameter if defined
  isVariadic?: boolean;         // Whether this is a variadic parameter (like *args or **kwargs)
}

/**
 * Source code location information
 */
export interface ISourceLocation {
  line: number;                 // Line number (1-based)
  column?: number;              // Column number (0-based, if available)
  endLine?: number;             // End line for multi-line elements
  endColumn?: number;           // End column for elements that span multiple columns
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
  location?: ISourceLocation;   // Detailed location information
  filePath: string;             // Path to the file containing this call
  parameters: IFunctionParameter[]; // Parameters passed to the function
  sourceCode?: string;          // The original source code for this function call
  parentFunctionId?: string;    // ID of the containing function (if this call is nested)
  calleeFunction?: string;      // ID or name of the function being called
  confidence: number;           // Confidence score (0-1) of the extraction accuracy
  callerClass?: string;         // Name of the class if this is a method call
  isCommandStyle?: boolean;     // Whether this is MATLAB command style call (without parentheses)
  isMethodCall?: boolean;       // Whether this is a method call on an object
  outputs?: string[];           // MATLAB output variables for this call
}

/**
 * Represents a defined function in the code (not just a call)
 */
export interface IFunctionDefinition {
  id: string;                   // Unique identifier for this function definition
  name: string;                 // Name of the function
  fullyQualifiedName?: string;  // Fully qualified name (with namespace/module)
  filePath: string;             // Path to the file containing this definition
  lineStart: number;            // Starting line of the function
  lineEnd: number;              // Ending line of the function
  location?: ISourceLocation;   // Detailed location information
  parameters: IFunctionParameter[]; // Parameters accepted by the function
  returnType?: string;          // Return type if available
  returnValue?: string;         // Return value pattern if extractable
  returnValues?: string[];      // Return values (for MATLAB multiple outputs)
  documentation?: string;       // Associated documentation/comments if available
  body?: string;                // Function body code (may be omitted for large functions)
  isMethod?: boolean;           // Whether this is a class method
  isConstructor?: boolean;      // Whether this is a constructor
  isStatic?: boolean;           // Whether this is a static method
  isAsync?: boolean;            // Whether this is an async function (Python)
  decorators?: string[];        // Function decorators (Python)
  visibility?: string;          // Access modifier (public, private, etc.)
  className?: string;           // Name of the containing class if applicable
}

/**
 * Represents an import statement
 */
export interface IImport {
  module: string;               // Module being imported
  name?: string;                // Specific name being imported (if applicable)
  alias?: string;               // Alias for the import (if any)
  location?: ISourceLocation;   // Location in source code
  isFromImport?: boolean;       // Whether this is a 'from X import Y' style (Python)
}

/**
 * Represents a variable declaration
 */
export interface IVariable {
  name: string;                 // Variable name
  location?: ISourceLocation;   // Location in source code
  type?: string;                // Type if available (inferred or annotated)
  initialValue?: string;        // Initial value as string
  scope: string;                // Scope (global, function, class, etc.)
  isConstant?: boolean;         // Whether this is a constant
}

/**
 * Represents the result of parsing a code file
 */
export interface ICodeParserResult {
  filePath: string;             // Path to the parsed file
  language: string;             // Detected language
  functionCalls: IFunctionCall[]; // Extracted function calls
  functionDefinitions: IFunctionDefinition[]; // Extracted function definitions
  imports: IImport[] | string[]; // Import statements in the file (supporting both formats)
  variables?: IVariable[];      // Variable declarations
  dependencies: string[];       // Files this file depends on
  hasMainGuard?: boolean;       // Whether the file has a main guard (e.g., if __name__ == "__main__")
  parseErrors?: string[];       // Any errors encountered during parsing
  metadata?: Record<string, any>; // Additional language-specific metadata
  parserVersion?: string;       // Version of the parser used
  parserName?: string;          // Name of the parser used (LibCST, tree-sitter, etc.)
}

/**
 * Options for controlling the parsing process
 */
export interface IParserOptions {
  extractComments?: boolean;    // Whether to extract comments
  maxDepth?: number;            // Maximum depth for nested function calls
  includeSourceCode?: boolean;  // Whether to include the source code snippets
  analyzeFunctionBodies?: boolean; // Whether to analyze function bodies in detail
  extractVariables?: boolean;   // Whether to extract variable declarations
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