# Code Parser Service

The Code Parser Service is responsible for parsing code files to extract function calls, function definitions, imports, and other relevant information.

## Architecture

The parser service is designed with a modular, extensible architecture:

- `BaseCodeParser`: Abstract base class providing common functionality for all language parsers
- `CodeParserFactory`: Factory pattern for creating and registering language-specific parsers
- Language-specific implementations: Concrete parser implementations for each supported language

## Supported Languages

### Python Parser

The Python parser uses [LibCST](https://github.com/Instagram/LibCST) (Concrete Syntax Tree) for robust parsing of Python code. LibCST is a library developed by Meta/Instagram that provides a concrete syntax tree representation of Python code with full fidelity (preserving formatting, comments, etc.).

Key features:
- Visitor pattern implementation for thorough AST traversal
- Support for modern Python syntax (3.x features)
- Detailed source location tracking
- Comprehensive docstring extraction
- Robust handling of complex Python constructs

### MATLAB Parser

The MATLAB parser uses [tree-sitter-matlab](https://github.com/acristoffers/matlab-grammar) with the [code-ast](https://github.com/m-ld/code-ast) wrapper for parsing MATLAB code. Tree-sitter is a parser generator tool that can build a concrete syntax tree for source code.

Key features:
- Support for both function call syntaxes in MATLAB (parentheses and command form)
- Robust handling of MATLAB's multiple output parameters
- Support for MATLAB classes and methods
- Name-value pair argument handling
- Detailed docstring extraction

For robustness, both parsers have a fallback implementation using regex-based parsing when the primary parser fails.

## Usage

```typescript
import { CodeParserFactory, CodeParserId } from './services/codeParser';

// Get a parser instance
const factory = CodeParserFactory.getInstance();
const pythonParser = factory.getParser(CodeParserId.PYTHON);
const matlabParser = factory.getParser(CodeParserId.MATLAB);

// Parse a file
const pythonResult = await pythonParser.parseFile('path/to/file.py');
const matlabResult = await matlabParser.parseFile('path/to/file.m');

// Parse content directly
const pythonContentResult = await pythonParser.parseContent('def foo(): pass');
const matlabContentResult = await matlabParser.parseContent('function y = foo(x); y = x*2; end');
```

## Requirements

- Python parser requirements:
  - libcst (Python package)
  - code-ast (Python package)
  - tree-sitter (Python package)

- MATLAB parser requirements:
  - tree-sitter (Node.js package)
  - tree-sitter-matlab (Node.js package)
  - code-ast (Node.js package)

## Result Format

The parser result follows a standardized format across all languages:

```typescript
interface ICodeParserResult {
  id: CodeParserId;
  source: string;
  functionCalls: FunctionCall[];
  functionDefinitions: FunctionDefinition[];
  imports: ImportStatement[];
  errors: string[];
  success: boolean;
}
``` 