#!/usr/bin/env python3
"""
Python code parser using LibCST for function call and definition extraction.
This parser extracts function calls, function definitions, and their parameters from Python code.
"""

import sys
import json
import libcst as cst
from typing import Dict, List, Any, Optional
from dataclasses import dataclass, field, asdict


@dataclass
class Location:
    """Class representing a source code location."""
    line: int
    column: int


@dataclass
class FunctionCall:
    """Class representing a function call."""
    name: str
    qualified_name: str = ""
    arguments: Dict[str, Any] = field(default_factory=dict)
    location: Optional[Location] = None
    caller: str = ""


@dataclass
class FunctionParameter:
    """Class representing a function parameter."""
    name: str
    annotation: str = ""
    default_value: str = ""
    is_keyword_only: bool = False
    is_positional_only: bool = False
    is_variadic: bool = False


@dataclass
class FunctionDefinition:
    """Class representing a function definition."""
    name: str
    qualified_name: str = ""
    parameters: List[FunctionParameter] = field(default_factory=list)
    return_annotation: str = ""
    docstring: str = ""
    location: Optional[Location] = None
    decorators: List[str] = field(default_factory=list)
    is_method: bool = False
    is_async: bool = False


@dataclass
class ImportStatement:
    """Class representing an import statement."""
    module: str
    name: str
    alias: str = ""
    location: Optional[Location] = None


@dataclass
class ParserResult:
    """Class for storing the parse results."""
    function_calls: List[FunctionCall] = field(default_factory=list)
    function_definitions: List[FunctionDefinition] = field(default_factory=list)
    imports: List[ImportStatement] = field(default_factory=list)
    errors: List[str] = field(default_factory=list)


class ImportCollector(cst.CSTVisitor):
    """Visitor to collect import statements."""
    
    def __init__(self):
        super().__init__()
        self.imports: List[ImportStatement] = []
        
    def visit_Import(self, node: cst.Import) -> None:
        for import_alias in node.names:
            name = import_alias.name.value
            alias = import_alias.asname.name.value if import_alias.asname else ""
            # LibCST nodes don't have position attribute, so we set it to None
            location = None
            self.imports.append(ImportStatement(
                module=name,
                name=name,
                alias=alias,
                location=location
            ))
    
    def visit_ImportFrom(self, node: cst.ImportFrom) -> None:
        # Extract module name safely
        module = ""
        if node.module:
            # Handle different LibCST versions
            try:
                if hasattr(node.module, 'names'):
                    # Newer version of LibCST
                    module = ".".join(name.value for name in node.module.names)
                elif hasattr(node.module, 'value'):
                    # Older version of LibCST
                    module = node.module.value
                else:
                    # Unknown structure
                    module = str(node.module)
            except AttributeError:
                module = str(node.module)
        
        for import_alias in node.names:
            name = import_alias.name.value
            alias = import_alias.asname.name.value if import_alias.asname else ""
            # LibCST nodes don't have position attribute, so we set it to None
            location = None
            self.imports.append(ImportStatement(
                module=module,
                name=name,
                alias=alias,
                location=location
            ))


class FunctionDefCollector(cst.CSTVisitor):
    """Visitor to collect function definitions."""
    
    def __init__(self):
        super().__init__()
        self.function_definitions: List[FunctionDefinition] = []
        self.current_class = []
        
    def visit_ClassDef(self, node: cst.ClassDef) -> bool:
        self.current_class.append(node.name.value)
        return True
    
    def leave_ClassDef(self, node: cst.ClassDef) -> None:
        self.current_class.pop()
    
    def visit_FunctionDef(self, node: cst.FunctionDef) -> None:
        """Visit a function definition and extract its information."""
        name = node.name.value
        qualified_name = f"{'.'.join(self.current_class)}.{name}" if self.current_class else name
        
        # Get parameters
        parameters = []
        for param in node.params.params:
            param_name = param.name.value
            param_annotation = ""
            if param.annotation:
                param_annotation = self._extract_annotation(param.annotation.annotation)
            
            default_value = ""
            if param.default:
                default_value = "..."  # Default value placeholder
            
            parameters.append(FunctionParameter(
                name=param_name,
                annotation=param_annotation,
                default_value=default_value,
                is_keyword_only=False,  # Can be refined with more complex logic
                is_positional_only=False,  # Can be refined with more complex logic
                is_variadic=param_name.startswith("*")
            ))
        
        # Handle star_arg and kwonly_params
        if node.params.star_arg:
            # Check if star_arg is a Parameter or just a string for "*"
            if hasattr(node.params.star_arg, 'name') and hasattr(node.params.star_arg.name, 'value'):
                star_name = f"*{node.params.star_arg.name.value}"
            else:
                star_name = "*"
                
            parameters.append(FunctionParameter(
                name=star_name,
                is_variadic=True
            ))
        
        # Handle kwonly params
        for param in node.params.kwonly_params:
            param_name = param.name.value
            param_annotation = ""
            if param.annotation:
                param_annotation = self._extract_annotation(param.annotation.annotation)
            
            default_value = ""
            if param.default:
                default_value = "..."  # Default value placeholder
            
            parameters.append(FunctionParameter(
                name=param_name,
                annotation=param_annotation,
                default_value=default_value,
                is_keyword_only=True
            ))
        
        # Handle star_kwarg
        if node.params.star_kwarg:
            parameters.append(FunctionParameter(
                name=f"**{node.params.star_kwarg.name.value}",
                is_variadic=True
            ))
        
        # Get return annotation
        return_annotation = ""
        if node.returns:
            return_annotation = self._extract_annotation(node.returns.annotation)
        
        # Extract docstring
        docstring = ""
        if node.body.body and isinstance(node.body.body[0], cst.SimpleString):
            # Get raw string value without quotes
            raw_string = node.body.body[0].value
            # Remove quotes from the beginning and end
            if raw_string.startswith(("'", '"')) and raw_string.endswith(("'", '"')):
                docstring = raw_string[1:-1]
            else:
                docstring = raw_string
        
        # Get decorators
        decorators = []
        for decorator in node.decorators:
            if isinstance(decorator.decorator, cst.Name):
                decorators.append(decorator.decorator.value)
            elif isinstance(decorator.decorator, cst.Attribute):
                decorators.append(self._get_attribute_name(decorator.decorator))
        
        # LibCST nodes don't have position attribute, so we set it to None
        location = None
        
        self.function_definitions.append(FunctionDefinition(
            name=name,
            qualified_name=qualified_name,
            parameters=parameters,
            return_annotation=return_annotation,
            docstring=docstring,
            location=location,
            decorators=decorators,
            is_method=bool(self.current_class),
            is_async=False  # Regular function is not async
        ))
    
    def visit_AsyncFunctionDef(self, node: cst.FunctionDef) -> None:
        """Visit an async function definition and extract its information."""
        # Handle async functions the same way as regular functions but mark as async
        self.visit_FunctionDef(node)
        if self.function_definitions:
            self.function_definitions[-1].is_async = True
    
    def _get_attribute_name(self, node: cst.Attribute) -> str:
        """Get the full name of an attribute (e.g., module.submodule.name)."""
        if isinstance(node.value, cst.Name):
            return f"{node.value.value}.{node.attr.value}"
        elif isinstance(node.value, cst.Attribute):
            return f"{self._get_attribute_name(node.value)}.{node.attr.value}"
        return f"?.{node.attr.value}"
    
    def _extract_annotation(self, node: cst.BaseExpression) -> str:
        """Extract type annotation from a node."""
        if isinstance(node, cst.Name):
            return node.value
        elif isinstance(node, cst.Attribute):
            return self._get_attribute_name(node)
        elif isinstance(node, cst.Subscript):
            # Handle generic types like List[int]
            if isinstance(node.value, cst.Name):
                return f"{node.value.value}[...]"
            elif isinstance(node.value, cst.Attribute):
                return f"{self._get_attribute_name(node.value)}[...]"
        return "..."


class FunctionCallCollector(cst.CSTVisitor):
    """Visitor to collect function calls."""
    
    def __init__(self):
        super().__init__()
        self.function_calls: List[FunctionCall] = []
        self.current_function: List[str] = []

    def visit_ClassDef(self, node: cst.ClassDef) -> bool:
        self.current_function.append(f"class.{node.name.value}")
        return True
    
    def leave_ClassDef(self, node: cst.ClassDef) -> None:
        self.current_function.pop()

    def visit_FunctionDef(self, node: cst.FunctionDef) -> bool:
        self.current_function.append(node.name.value)
        return True
    
    def leave_FunctionDef(self, node: cst.FunctionDef) -> None:
        self.current_function.pop()

    def visit_AsyncFunctionDef(self, node: cst.FunctionDef) -> bool:
        # Handle async functions the same way as regular functions
        return self.visit_FunctionDef(node)
    
    def leave_AsyncFunctionDef(self, node: cst.FunctionDef) -> None:
        self.leave_FunctionDef(node)
    
    def visit_Call(self, node: cst.Call) -> None:
        caller = self.current_function[-1] if self.current_function else ""
        
        # Get function name
        if isinstance(node.func, cst.Name):
            name = node.func.value
            qualified_name = name
        elif isinstance(node.func, cst.Attribute):
            name = node.func.attr.value
            qualified_name = self._get_attribute_name(node.func)
        else:
            name = "unknown"
            qualified_name = "unknown"
        
        # Get arguments
        arguments = {
            "positional": [],
            "keywords": {}
        }
        
        # Process positional arguments
        for arg in node.args:
            if isinstance(arg.value, cst.Name):
                arguments["positional"].append(arg.value.value)
            elif isinstance(arg.value, cst.SimpleString):
                # Get raw string value without quotes
                raw_string = arg.value.value
                # Remove quotes from the beginning and end
                if raw_string.startswith(("'", '"')) and raw_string.endswith(("'", '"')):
                    arguments["positional"].append(raw_string[1:-1])
                else:
                    arguments["positional"].append(raw_string)
            elif isinstance(arg.value, (cst.Integer, cst.Float)):
                arguments["positional"].append(str(arg.value.value))
            else:
                arguments["positional"].append("...")
        
        # Process keyword arguments if they exist
        # This try-except block handles differences in LibCST versions
        try:
            if hasattr(node, 'keywords'):
                for kwarg in node.keywords:
                    key = kwarg.keyword.value
                    if isinstance(kwarg.value, cst.Name):
                        arguments["keywords"][key] = kwarg.value.value
                    elif isinstance(kwarg.value, cst.SimpleString):
                        # Get raw string value without quotes
                        raw_string = kwarg.value.value
                        # Remove quotes from the beginning and end
                        if raw_string.startswith(("'", '"')) and raw_string.endswith(("'", '"')):
                            arguments["keywords"][key] = raw_string[1:-1]
                        else:
                            arguments["keywords"][key] = raw_string
                    elif isinstance(kwarg.value, (cst.Integer, cst.Float)):
                        arguments["keywords"][key] = str(kwarg.value.value)
                    elif isinstance(kwarg.value, cst.BooleanOperation):
                        arguments["keywords"][key] = "..."  # Boolean expression
                    else:
                        arguments["keywords"][key] = "..."
            elif hasattr(node, 'keyword'):
                # Alternative structure in some LibCST versions
                for kwarg in node.keyword:
                    key = kwarg.arg.value
                    value = "..."  # Default placeholder
                    if isinstance(kwarg.value, cst.Name):
                        value = kwarg.value.value
                    elif isinstance(kwarg.value, cst.SimpleString):
                        value = kwarg.value.value
                        if value.startswith(("'", '"')) and value.endswith(("'", '"')):
                            value = value[1:-1]
                    arguments["keywords"][key] = value
        except (AttributeError, TypeError) as e:
            # Just log the error in debug mode but continue
            arguments["keywords"]["error"] = f"Failed to parse keywords: {str(e)}"
        
        # LibCST nodes don't have position attribute, so we set it to None
        location = None
        
        self.function_calls.append(FunctionCall(
            name=name,
            qualified_name=qualified_name,
            arguments=arguments,
            location=location,
            caller=caller
        ))
    
    def _get_attribute_name(self, node: cst.Attribute) -> str:
        """Get the full name of an attribute (e.g., module.submodule.name)."""
        if isinstance(node.value, cst.Name):
            return f"{node.value.value}.{node.attr.value}"
        elif isinstance(node.value, cst.Attribute):
            return f"{self._get_attribute_name(node.value)}.{node.attr.value}"
        return f"?.{node.attr.value}"


def parse_code(code: str) -> Dict[str, Any]:
    """Parse Python code and extract function calls, definitions, and imports."""
    try:
        module = cst.parse_module(code)
        
        # Collect imports
        import_collector = ImportCollector()
        module.visit(import_collector)
        
        # Collect function definitions
        func_def_collector = FunctionDefCollector()
        module.visit(func_def_collector)
        
        # Collect function calls
        func_call_collector = FunctionCallCollector()
        module.visit(func_call_collector)
        
        result = ParserResult(
            function_calls=func_call_collector.function_calls,
            function_definitions=func_def_collector.function_definitions,
            imports=import_collector.imports,
            errors=[]
        )
        
        return asdict(result)
    
    except Exception as e:
        import traceback
        traceback_str = traceback.format_exc()
        return {
            "function_calls": [],
            "function_definitions": [],
            "imports": [],
            "errors": [f"{str(e)}\n{traceback_str}"]
        }


def main():
    """Main function for CLI usage."""
    if len(sys.argv) > 1:
        file_path = sys.argv[1]
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                code = f.read()
            result = parse_code(code)
            print(json.dumps(result, indent=2))
        except Exception as e:
            print(json.dumps({"error": str(e)}), file=sys.stderr)
            sys.exit(1)
    else:
        # Read from stdin if no file path provided
        code = sys.stdin.read()
        result = parse_code(code)
        print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main() 