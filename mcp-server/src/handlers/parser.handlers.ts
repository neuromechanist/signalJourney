/**
 * Handlers for code parsing MCP tools.
 * These handlers provide MCP tools for parsing code files and extracting function calls.
 */

import { z } from 'zod';
import { ServerRequest, ServerNotification } from '@modelcontextprotocol/sdk/types.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';

import { McpExecutionContext, CallToolResult } from '@/core/mcp-types';
import { CodeParserService } from '@/services/codeParser/service';
import { IParserOptions, SupportedLanguage } from '@/services/codeParser/types';
import logger from '@/utils/logger';

// Schema for parseCode tool
export const parseCodeParamsSchema = z.object({
  filePath: z.string().min(1).describe('Path to the file to parse'),
  language: z.enum(['python', 'matlab', 'unknown']).optional().describe('Override the language detection'),
  extractComments: z.boolean().optional().default(true).describe('Whether to extract comments'),
  maxDepth: z.number().int().positive().optional().default(3).describe('Maximum depth for nested function calls'),
  includeSourceCode: z.boolean().optional().default(false).describe('Whether to include source code snippets'),
});

export type ParseCodeParams = z.infer<typeof parseCodeParamsSchema>;

// Schema for parseContent tool
export const parseContentParamsSchema = z.object({
  content: z.string().min(1).describe('Code content to parse'),
  language: z.enum(['python', 'matlab']).describe('Language of the code content'),
  extractComments: z.boolean().optional().default(true).describe('Whether to extract comments'),
  maxDepth: z.number().int().positive().optional().default(3).describe('Maximum depth for nested function calls'),
  includeSourceCode: z.boolean().optional().default(false).describe('Whether to include source code snippets'),
});

export type ParseContentParams = z.infer<typeof parseContentParamsSchema>;

/**
 * Handler for the 'parser.parseFile' MCP tool
 * Parses a single file and extracts function calls
 */
export async function handleParseFile(
  args: ParseCodeParams,
  extra: RequestHandlerExtra<ServerRequest, ServerNotification>
): Promise<CallToolResult> {
  const parserService = new CodeParserService();
  const requestId = extra.requestId || `parse-${Date.now()}`;
  
  logger.info(`[${requestId}] Received parse_file request for: ${args.filePath}`);
  
  try {
    // Prepare parser options
    const options: IParserOptions = {
      extractComments: args.extractComments,
      maxDepth: args.maxDepth,
      includeSourceCode: args.includeSourceCode,
    };
    
    // If language is specified, convert it to the enum value
    let language: SupportedLanguage | undefined;
    if (args.language) {
      switch (args.language) {
        case 'python':
          language = SupportedLanguage.PYTHON;
          break;
        case 'matlab':
          language = SupportedLanguage.MATLAB;
          break;
        default:
          language = SupportedLanguage.UNKNOWN;
      }
    }
    
    // Parse the file
    const result = await parserService.parseFile(args.filePath, options);
    
    // Return the result
    return {
      content: [{ 
        type: 'text', 
        text: JSON.stringify({
          success: true,
          requestId,
          result
        })
      }]
    };
  } catch (error: any) {
    logger.error(`[${requestId}] Parse file failed:`, error);
    
    return {
      content: [{ 
        type: 'text', 
        text: JSON.stringify({ 
          success: false, 
          error: error.message || 'An unknown error occurred',
          code: error.code || 'UNKNOWN_ERROR',
          requestId
        }) 
      }]
    };
  }
}

/**
 * Handler for the 'parser.parseContent' MCP tool
 * Parses raw code content and extracts function calls
 */
export async function handleParseContent(
  args: ParseContentParams,
  extra: RequestHandlerExtra<ServerRequest, ServerNotification>
): Promise<CallToolResult> {
  const parserService = new CodeParserService();
  const requestId = extra.requestId || `parse-${Date.now()}`;
  
  logger.info(`[${requestId}] Received parse_content request for ${args.language} code`);
  
  try {
    // Prepare parser options
    const options: IParserOptions = {
      extractComments: args.extractComments,
      maxDepth: args.maxDepth,
      includeSourceCode: args.includeSourceCode,
    };
    
    // Convert language string to enum
    let language: SupportedLanguage;
    switch (args.language) {
      case 'python':
        language = SupportedLanguage.PYTHON;
        break;
      case 'matlab':
        language = SupportedLanguage.MATLAB;
        break;
      default:
        language = SupportedLanguage.UNKNOWN;
    }
    
    // Parse the content
    const result = await parserService.parseContent(args.content, language, options);
    
    // Return the result
    return {
      content: [{ 
        type: 'text', 
        text: JSON.stringify({
          success: true,
          requestId,
          result
        })
      }]
    };
  } catch (error: any) {
    logger.error(`[${requestId}] Parse content failed:`, error);
    
    return {
      content: [{ 
        type: 'text', 
        text: JSON.stringify({ 
          success: false, 
          error: error.message || 'An unknown error occurred',
          code: error.code || 'UNKNOWN_ERROR',
          requestId
        }) 
      }]
    };
  }
} 