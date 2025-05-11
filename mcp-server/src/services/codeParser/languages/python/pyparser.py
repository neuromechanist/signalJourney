#!/usr/bin/env python3
"""
Python AST-based code parser for extracting function calls and definitions.

This script is designed to be called from the TypeScript code parser to provide
high-quality parsing of Python files. It uses the native AST module to extract
function calls, definitions, imports, and variable assignments.

Usage:
  python pyparser.py <file_path>
  cat <file> | python pyparser.py

Output is a JSON object with the parsed code structure.
"""

import ast
import json
import sys
import os.path
from typing import Dict, List, Any, Optional, Union, Set, Tuple


class FunctionCallVisitor(ast.NodeVisitor):
    """AST visitor to extract function calls and their relationships."""
    
    def __init__(self):
        self.function_calls = []
        self.function_defs = []
        self.imports = []
        self.variables = []
        self.current_function = None
        self.current_class = None
        self.import_aliases = {}
        
    def visit_Import(self, node):
        """Process import statements."""
        for name in node.names:
            alias = name.asname if name.asname else name.name
            self.import_aliases[alias] = name.name
            self.imports.append({
                'type': 'import',
                'name': name.name,
                'alias': alias,
                'line': node.lineno,
                'column': node.col_offset
            })
        self.generic_visit(node)
        
    def visit_ImportFrom(self, node):
        """Process from ... import statements."""
        module = node.module if node.module else ''
        for name in node.names:
            full_name = f"{module}.{name.name}" if module else name.name
            alias = name.asname if name.asname else name.name
            self.import_aliases[alias] = full_name
            self.imports.append({
                'type': 'importfrom',
                'module': module,
                'name': name.name,
                'full_name': full_name,
                'alias': alias,
                'line': node.lineno,
                'column': node.col_offset
            })
        self.generic_visit(node)
        
    def visit_Assign(self, node):
        """Process variable assignments."""
        for target in node.targets:
            if isinstance(target, ast.Name):
                self.variables.append({
                    'name': target.id,
                    'line': node.lineno,
                    'column': node.col_offset,
                    'scope': self.current_function or 'global'
                })
        self.generic_visit(node)
        
    def visit_FunctionDef(self, node):
        """Process function definitions."""
        previous_function = self.current_function
        self.current_function = node.name
        
        # Function parameters
        params = []
        for arg in node.args.args:
            params.append({
                'name': arg.arg,
                'annotation': self._get_annotation(arg.annotation) if hasattr(arg, 'annotation') and arg.annotation else None
            })
            
        # Default values
        defaults = node.args.defaults
        default_offset = len(params) - len(defaults)
        for i, default in enumerate(defaults):
            params[i + default_offset]['default'] = self._get_value(default)
            
        # Keyword only arguments
        for arg in node.args.kwonlyargs:
            params.append({
                'name': arg.arg,
                'keyword_only': True,
                'annotation': self._get_annotation(arg.annotation) if hasattr(arg, 'annotation') and arg.annotation else None
            })
            
        # Keyword defaults
        for i, (arg, default) in enumerate(zip(node.args.kwonlyargs, node.args.kw_defaults)):
            if default:
                params[len(node.args.args) + i]['default'] = self._get_value(default)
                
        # Varargs and kwargs
        if node.args.vararg:
            params.append({
                'name': node.args.vararg.arg,
                'is_vararg': True,
                'annotation': self._get_annotation(node.args.vararg.annotation) if hasattr(node.args.vararg, 'annotation') and node.args.vararg.annotation else None
            })
            
        if node.args.kwarg:
            params.append({
                'name': node.args.kwarg.arg,
                'is_kwarg': True,
                'annotation': self._get_annotation(node.args.kwarg.annotation) if hasattr(node.args.kwarg, 'annotation') and node.args.kwarg.annotation else None
            })
        
        # Extract function return annotation
        return_annotation = self._get_annotation(node.returns) if hasattr(node, 'returns') and node.returns else None
        
        # Create the function definition object
        func_def = {
            'name': node.name,
            'qualified_name': f"{self.current_class}.{node.name}" if self.current_class else node.name,
            'parameters': params,
            'return_annotation': return_annotation,
            'decorators': [self._get_name(decorator) for decorator in node.decorator_list],
            'line': node.lineno,
            'column': node.col_offset,
            'class_context': self.current_class
        }
        
        self.function_defs.append(func_def)
        
        # Visit function body
        self.generic_visit(node)
        
        # Restore previous function context
        self.current_function = previous_function
        
    def visit_ClassDef(self, node):
        """Process class definitions."""
        previous_class = self.current_class
        self.current_class = node.name
        
        # Visit class body
        self.generic_visit(node)
        
        # Restore previous class context
        self.current_class = previous_class
        
    def visit_Call(self, node):
        """Process function calls."""
        # Get function name
        func_name = self._get_name(node.func)
        
        # Process arguments
        args = []
        for i, arg in enumerate(node.args):
            arg_value = self._get_value(arg)
            args.append({
                'name': None,  # Positional argument, no name
                'value': arg_value,
                'position': i,
                'is_named': False
            })
            
        # Process keyword arguments
        for i, kw in enumerate(node.keywords):
            if kw.arg is None:  # **kwargs case
                args.append({
                    'name': None,
                    'value': self._get_name(kw.value),
                    'position': len(node.args) + i,
                    'is_named': True,
                    'is_kwargs_unpacking': True
                })
            else:
                args.append({
                    'name': kw.arg,
                    'value': self._get_value(kw.value),
                    'position': len(node.args) + i,
                    'is_named': True
                })
        
        # Create function call object
        call = {
            'name': func_name,
            'qualified_name': func_name,  # Will need context resolution for full qualification
            'arguments': args,
            'line': node.lineno,
            'column': node.col_offset,
            'caller': self.current_function,
            'class_context': self.current_class
        }
        
        self.function_calls.append(call)
        
        # Continue visiting child nodes
        self.generic_visit(node)
    
    def _get_name(self, node) -> str:
        """Extract a function or attribute name from an AST node."""
        if isinstance(node, ast.Name):
            return node.id
        elif isinstance(node, ast.Attribute):
            base = self._get_name(node.value)
            return f"{base}.{node.attr}"
        elif isinstance(node, ast.Call):
            # Handle call expressions like foo()()
            return f"{self._get_name(node.func)}"
        elif isinstance(node, ast.Subscript):
            # Handle subscript expressions like module[name]
            return f"{self._get_name(node.value)}[{self._get_value(node.slice)}]"
        else:
            return f"<unknown:{type(node).__name__}>"
    
    def _get_value(self, node) -> str:
        """Convert an AST node to its string representation."""
        if isinstance(node, ast.Str):
            return f'"{node.s}"'
        elif isinstance(node, ast.Num):
            return str(node.n)
        elif isinstance(node, ast.NameConstant):
            return str(node.value)
        elif isinstance(node, ast.Name):
            return node.id
        elif isinstance(node, ast.List):
            items = [self._get_value(elt) for elt in node.elts]
            return f"[{', '.join(items)}]"
        elif isinstance(node, ast.Tuple):
            items = [self._get_value(elt) for elt in node.elts]
            return f"({', '.join(items)})"
        elif isinstance(node, ast.Dict):
            items = [f"{self._get_value(k)}: {self._get_value(v)}" for k, v in zip(node.keys, node.values)]
            return f"{{{', '.join(items)}}}"
        elif isinstance(node, ast.Call):
            return f"{self._get_name(node.func)}(...)"
        elif isinstance(node, ast.Attribute):
            return f"{self._get_name(node.value)}.{node.attr}"
        elif isinstance(node, (ast.Constant)):
            # For Python 3.8+
            if isinstance(node.value, str):
                return f'"{node.value}"'
            return str(node.value)
        else:
            return f"<complex-value:{type(node).__name__}>"

    def _get_annotation(self, node) -> str:
        """Extract type annotation from an AST node."""
        if node is None:
            return None
        return self._get_value(node)


def parse_file(file_path: str) -> Dict[str, Any]:
    """Parse a Python file and extract function calls and definitions."""
    try:
        with open(file_path, 'r') as f:
            content = f.read()
        return parse_content(content, file_path)
    except Exception as e:
        return {
            'error': str(e),
            'function_calls': [],
            'function_definitions': [],
            'imports': [],
            'variables': []
        }


def parse_content(content: str, file_path: Optional[str] = None) -> Dict[str, Any]:
    """Parse Python code content and extract function calls and definitions."""
    try:
        tree = ast.parse(content)
        visitor = FunctionCallVisitor()
        visitor.visit(tree)
        
        return {
            'language': 'python',
            'source_file': file_path,
            'function_calls': visitor.function_calls,
            'function_definitions': visitor.function_defs,
            'imports': visitor.imports,
            'variables': visitor.variables
        }
    except SyntaxError as e:
        # Return partial results with error information
        return {
            'language': 'python',
            'source_file': file_path,
            'error': f"SyntaxError: {str(e)}",
            'error_line': e.lineno,
            'error_offset': e.offset,
            'function_calls': [],
            'function_definitions': [],
            'imports': [],
            'variables': []
        }
    except Exception as e:
        return {
            'language': 'python',
            'source_file': file_path,
            'error': f"Error: {str(e)}",
            'function_calls': [],
            'function_definitions': [],
            'imports': [],
            'variables': []
        }


def main():
    """Main entry point for the script."""
    # Check if input is from pipe
    if not sys.stdin.isatty():
        # Read from stdin
        content = sys.stdin.read()
        result = parse_content(content)
        print(json.dumps(result, indent=2))
        return
        
    # Otherwise get from file
    if len(sys.argv) < 2:
        print("Usage: python pyparser.py <file_path>")
        return
        
    file_path = sys.argv[1]
    if not os.path.exists(file_path):
        print(json.dumps({
            'error': f"File not found: {file_path}",
            'function_calls': [],
            'function_definitions': [],
            'imports': [],
            'variables': []
        }, indent=2))
        return
        
    result = parse_file(file_path)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main() 