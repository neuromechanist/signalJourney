/**
 * Parser output normalizer.
 * Transforms language-specific parser outputs into a consistent schema.
 */

import {
  ICodeParserResult,
  IFunctionCall,
  IFunctionDefinition,
  IFunctionParameter,
  IImport,
  IVariable,
  SupportedLanguage,
  ParameterStyle,
  ISourceLocation
} from './types';

/**
 * Normalizes parser output to a consistent schema across languages
 */
export class ParserOutputNormalizer {
  /**
   * Normalize a parser result to the standard format
   * @param result The raw parser result
   * @param language The language of the parsed content
   * @param parserName Optional name of the parser used
   * @returns Normalized parser result
   */
  public normalizeResult(
    result: any,
    language: SupportedLanguage,
    parserName?: string
  ): ICodeParserResult {
    // Start with a normalized structure to ensure all required fields are present
    const normalized: ICodeParserResult = {
      filePath: result.filePath || result.file || '<unknown>',
      language: language.toString(),
      functionCalls: [],
      functionDefinitions: [],
      imports: [],
      dependencies: result.dependencies || [],
      parseErrors: result.parseErrors || result.errors || [],
      metadata: { ...result.metadata },
      parserName: parserName
    };

    // Normalize function calls
    if (result.functionCalls || result.function_calls) {
      normalized.functionCalls = (result.functionCalls || result.function_calls || [])
        .map((call: any) => this.normalizeCall(call, language));
    }

    // Normalize function definitions
    if (result.functionDefinitions || result.function_definitions) {
      normalized.functionDefinitions = (result.functionDefinitions || result.function_definitions || [])
        .map((def: any) => this.normalizeDefinition(def, language));
    }

    // Normalize imports based on the language
    if (result.imports) {
      if (Array.isArray(result.imports)) {
        if (typeof result.imports[0] === 'string') {
          // Legacy format where imports are just strings
          normalized.imports = result.imports;
        } else {
          // New format with structured imports
          normalized.imports = result.imports.map((imp: any) => this.normalizeImport(imp, language));
        }
      }
    }

    // Normalize variables if present
    if (result.variables) {
      normalized.variables = result.variables.map((v: any) => this.normalizeVariable(v, language));
    }

    // Set language-specific properties
    if (language === SupportedLanguage.PYTHON) {
      normalized.hasMainGuard = result.hasMainGuard ?? false;
    }

    // Add parser metadata
    normalized.parserVersion = result.parserVersion;

    return normalized;
  }

  /**
   * Normalize a function call to the standard format
   * @param call The raw function call
   * @param language The language of the parsed content
   * @returns Normalized function call
   */
  public normalizeCall(call: any, language: SupportedLanguage): IFunctionCall {
    const location: ISourceLocation = {
      line: call.line || call.lineNumber || (call.location ? call.location.line : 0),
      column: call.column || call.columnNumber || (call.location ? call.location.column : undefined),
    };

    const normalized: IFunctionCall = {
      id: call.id || `call_${Math.random().toString(36).substring(2, 9)}`,
      name: call.name,
      fullyQualifiedName: call.qualifiedName || call.qualified_name,
      lineNumber: location.line,
      columnNumber: location.column,
      location,
      filePath: call.filePath || '',
      parameters: this.normalizeParameters(call.parameters || call.arguments, language),
      sourceCode: call.sourceCode,
      parentFunctionId: call.parentFunctionId || call.parentFunction,
      calleeFunction: call.calleeFunction,
      confidence: call.confidence || 1.0,
      callerClass: call.callerClass || call.class
    };

    // Handle MATLAB-specific properties
    if (language === SupportedLanguage.MATLAB) {
      normalized.isCommandStyle = call.isCommandStyle || call.is_command_style;
      normalized.isMethodCall = call.isMethodCall || call.is_method_call;
      normalized.outputs = call.outputs;
    }

    return normalized;
  }

  /**
   * Normalize a function definition to the standard format
   * @param def The raw function definition
   * @param language The language of the parsed content
   * @returns Normalized function definition
   */
  public normalizeDefinition(def: any, language: SupportedLanguage): IFunctionDefinition {
    const location: ISourceLocation = {
      line: def.line || def.lineStart || (def.location ? def.location.line : 0),
      column: def.column || (def.location ? def.location.column : undefined),
      endLine: def.lineEnd || (def.location ? def.location.endLine : undefined),
    };

    const normalized: IFunctionDefinition = {
      id: def.id || `def_${Math.random().toString(36).substring(2, 9)}`,
      name: def.name,
      fullyQualifiedName: def.qualifiedName || def.qualified_name,
      filePath: def.filePath || '',
      lineStart: location.line,
      lineEnd: location.endLine || location.line + 1,
      location,
      parameters: this.normalizeParameters(def.parameters, language),
      returnType: def.returnType || def.return_type || def.returnAnnotation || def.return_annotation,
      documentation: def.documentation || def.docstring,
      body: def.body
    };

    // Handle language-specific properties
    if (language === SupportedLanguage.PYTHON) {
      normalized.isAsync = def.isAsync || def.is_async;
      normalized.decorators = def.decorators;
    } else if (language === SupportedLanguage.MATLAB) {
      normalized.returnValues = def.outputs || def.returnValues || def.return_values;
    }

    // Common properties for both languages
    normalized.isMethod = def.isMethod || def.is_method;
    normalized.className = def.className || def.class_name;
    normalized.isConstructor = def.isConstructor || def.is_constructor;
    normalized.isStatic = def.isStatic || def.is_static;

    return normalized;
  }

  /**
   * Normalize an import statement to the standard format
   * @param imp The raw import
   * @param language The language of the parsed content
   * @returns Normalized import
   */
  private normalizeImport(imp: any, language: SupportedLanguage): IImport {
    let normalized: IImport = {
      module: imp.module || '',
      name: imp.name,
      alias: imp.alias,
      location: imp.location ? {
        line: imp.location.line,
        column: imp.location.column
      } : undefined
    };

    if (language === SupportedLanguage.PYTHON) {
      normalized.isFromImport = imp.isFromImport || imp.is_from_import;
    }

    return normalized;
  }

  /**
   * Normalize a variable declaration to the standard format
   * @param variable The raw variable
   * @param language The language of the parsed content
   * @returns Normalized variable
   */
  private normalizeVariable(variable: any, language: SupportedLanguage): IVariable {
    return {
      name: variable.name,
      location: variable.location ? {
        line: variable.location.line,
        column: variable.location.column
      } : undefined,
      type: variable.type || variable.annotation,
      initialValue: variable.initialValue || variable.initial_value,
      scope: variable.scope || 'global',
      isConstant: variable.isConstant || variable.is_constant
    };
  }

  /**
   * Normalize parameters to the standard format
   * @param parameters The raw parameters
   * @param language The language of the parsed content
   * @returns Normalized parameters
   */
  private normalizeParameters(parameters: any[] | any, language: SupportedLanguage): IFunctionParameter[] {
    // If parameters is an object with positional and keywords properties (from LibCST)
    if (parameters && !Array.isArray(parameters) && parameters.positional) {
      const result: IFunctionParameter[] = [];
      
      // Add positional parameters
      parameters.positional.forEach((value: any, index: number) => {
        result.push({
          position: index,
          value: typeof value === 'string' ? value : JSON.stringify(value),
          isNamed: false
        });
      });
      
      // Add keyword parameters
      if (parameters.keywords) {
        Object.entries(parameters.keywords).forEach(([name, value], index) => {
          result.push({
            name,
            position: result.length,
            value: typeof value === 'string' ? value : JSON.stringify(value),
            isNamed: true,
            style: ParameterStyle.NAMED
          });
        });
      }
      
      return result;
    }
    
    // If it's an array, normalize each parameter
    if (Array.isArray(parameters)) {
      return parameters.map((param, index) => {
        if (typeof param === 'string') {
          // Simple string parameter (legacy format)
          return {
            position: index,
            value: param,
            isNamed: false
          };
        } else {
          // Object parameter
          const normalized: IFunctionParameter = {
            name: param.name,
            position: param.position ?? index,
            value: param.value,
            isNamed: param.isNamed ?? param.is_named ?? false,
            isDefault: param.isDefault ?? param.is_default,
            inferredType: param.inferredType ?? param.inferred_type ?? param.annotation,
            annotation: param.annotation,
            defaultValue: param.defaultValue ?? param.default_value
          };

          // Determine parameter style based on flags
          if (param.isKeywordOnly || param.is_keyword_only) {
            normalized.style = ParameterStyle.KEYWORD_ONLY;
          } else if (param.isPositionalOnly || param.is_positional_only) {
            normalized.style = ParameterStyle.POSITIONAL_ONLY;
          } else if (param.isVararg || param.is_vararg || param.isVariadic || param.is_variadic) {
            normalized.isVariadic = true;
            
            if (language === SupportedLanguage.PYTHON) {
              if (param.isKwarg || param.is_kwarg) {
                normalized.style = ParameterStyle.VARIADIC_KEYWORD;
              } else {
                normalized.style = ParameterStyle.VARIADIC_POSITIONAL;
              }
            } else if (language === SupportedLanguage.MATLAB) {
              normalized.style = ParameterStyle.MATLAB_VARARG;
            }
          } else if (normalized.isNamed && language === SupportedLanguage.MATLAB) {
            normalized.style = ParameterStyle.NAME_VALUE_PAIR;
          } else if (normalized.isNamed) {
            normalized.style = ParameterStyle.NAMED;
          } else {
            normalized.style = ParameterStyle.POSITIONAL;
          }

          return normalized;
        }
      });
    }
    
    // Empty or unknown format
    return [];
  }
} 