#!/usr/bin/env python3
"""
Python code parser using LibCST for function call and definition extraction.
This parser extracts function calls, function definitions, and their parameters from Python code.
"""

import sys
import json
import libcst as cst
from typing import Dict, List, Any, Optional, Set, Union, Tuple, cast
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
            pos = node.position
            location = Location(pos.line, pos.column) if pos else None
            self.imports.append(ImportStatement(
                module=name,
                name=name,
                alias=alias,
                location=location
            ))
    
    def visit_ImportFrom(self, node: cst.ImportFrom) -> None:
        module = ""
        if node.module:
            module = ".".join(name.value for name in node.module.names)
        
        for import_alias in node.names:
            name = import_alias.name.value
            alias = import_alias.asname.name.value if import_alias.asname else ""
            pos = node.position
            location = Location(pos.line, pos.column) if pos else None
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
        self.current_class: List[str] = []
        
    def visit_ClassDef(self, node: cst.ClassDef) -> bool:
        self.current_class.append(node.name.value)
        return True
    
    def leave_ClassDef(self, node: cst.ClassDef) -> None:
        self.current_class.pop()
    
    def visit_FunctionDef(self, node: cst.FunctionDef) -> None:
        name = node.name.value
        qualified_name = f"{'.'.join(self.current_class)}.{name}" if self.current_class else name
        
        parameters = []
        for param in node.params.params:
            if isinstance(param, cst.Param):
                annotation = ""
                if param.annotation:
                    annotation_node = param.annotation.annotation
                    if isinstance(annotation_node, cst.Name):
                        annotation = annotation_node.value
                    elif isinstance(annotation_node, cst.Attribute):
                        annotation = self._get_attribute_name(annotation_node)
                
                default_value = ""
                if param.default:
                    default_value = self._get_node_value(param.default)
                
                parameters.append(FunctionParameter(
                    name=param.name.value,
                    annotation=annotation,
                    default_value=default_value,
                    is_keyword_only=False,  # Will set correctly based on param type
                    is_positional_only=False,  # Will set correctly based on param type
                    is_variadic=False  # Will set correctly based on param type
                ))
            elif isinstance(param, cst.StarParam):
                # This is *args
                if param.param:
                    parameters.append(FunctionParameter(
                        name=param.param.name.value,
                        is_variadic=True
                    ))
            elif isinstance(param, cst.ParamStar):
                # This is the * separator for keyword-only params
                pass
            elif isinstance(param, cst.Param):
                # Handle positional-only parameters (in Python 3.8+)
                pass
        
        # Handle keyword-only parameters
        for param in node.params.kwonly_params:
            annotation = ""
            if param.annotation:
                annotation_node = param.annotation.annotation
                if isinstance(annotation_node, cst.Name):
                    annotation = annotation_node.value
                elif isinstance(annotation_node, cst.Attribute):
                    annotation = self._get_attribute_name(annotation_node)
            
            default_value = ""
            if param.default:
                default_value = self._get_node_value(param.default)
            
            parameters.append(FunctionParameter(
                name=param.name.value,
                annotation=annotation,
                default_value=default_value,
                is_keyword_only=True
            ))
        
        # Handle **kwargs
        if node.params.star_kwarg:
            parameters.append(FunctionParameter(
                name=node.params.star_kwarg.name.value,
                is_variadic=True,
                is_keyword_only=True
            ))
        
        # Get return annotation
        return_annotation = ""
        if node.returns:
            returns_node = node.returns.annotation
            if isinstance(returns_node, cst.Name):
                return_annotation = returns_node.value
            elif isinstance(returns_node, cst.Attribute):
                return_annotation = self._get_attribute_name(returns_node)
        
        # Get docstring
        docstring = ""
        if (node.body.body and isinstance(node.body.body[0], cst.SimpleStatementLine) and 
            node.body.body[0].body and isinstance(node.body.body[0].body[0], cst.Expr) and
            isinstance(node.body.body[0].body[0].value, cst.SimpleString)):
            docstring = node.body.body[0].body[0].value.evaluated_value
        
        # Get decorators
        decorators = []
        for decorator in node.decorators:
            if isinstance(decorator.decorator, cst.Name):
                decorators.append(decorator.decorator.value)
            elif isinstance(decorator.decorator, cst.Attribute):
                decorators.append(self._get_attribute_name(decorator.decorator))
        
        # Get function location
        pos = node.position
        location = Location(pos.line, pos.column) if pos else None
        
        self.function_definitions.append(FunctionDefinition(
            name=name,
            qualified_name=qualified_name,
            parameters=parameters,
            return_annotation=return_annotation,
            docstring=docstring,
            location=location,
            decorators=decorators,
            is_method=bool(self.current_class),
            is_async=isinstance(node, cst.AsyncFunctionDef)
        ))
    
    def visit_AsyncFunctionDef(self, node: cst.AsyncFunctionDef) -> None:
        # Treat async functions the same as regular functions but mark as async
        self.visit_FunctionDef(node)
    
    def _get_attribute_name(self, node: cst.Attribute) -> str:
        """Get the full name of an attribute (e.g., module.submodule.name)."""
        if isinstance(node.value, cst.Name):
            return f"{node.value.value}.{node.attr.value}"
        elif isinstance(node.value, cst.Attribute):
            return f"{self._get_attribute_name(node.value)}.{node.attr.value}"
        return f"?.{node.attr.value}"
    
    def _get_node_value(self, node: cst.BaseExpression) -> str:
        """Get a string representation of a node's value."""
        if isinstance(node, cst.SimpleString):
            return node.evaluated_value
        elif isinstance(node, cst.Name):
            return node.value
        elif isinstance(node, cst.Integer):
            return str(node.value)
        elif isinstance(node, cst.Float):
            return str(node.value)
        elif isinstance(node, (cst.Dict, cst.List, cst.Tuple)):
            return "..." # Placeholder for complex values
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
    
    def visit_AsyncFunctionDef(self, node: cst.AsyncFunctionDef) -> bool:
        self.current_function.append(node.name.value)
        return True
    
    def leave_AsyncFunctionDef(self, node: cst.AsyncFunctionDef) -> None:
        self.current_function.pop()
    
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
                arguments["positional"].append(arg.value.evaluated_value)
            elif isinstance(arg.value, (cst.Integer, cst.Float)):
                arguments["positional"].append(str(arg.value.value))
            else:
                arguments["positional"].append("...")
        
        # Process keyword arguments
        for kwarg in node.keywords:
            key = kwarg.keyword.value
            if isinstance(kwarg.value, cst.Name):
                arguments["keywords"][key] = kwarg.value.value
            elif isinstance(kwarg.value, cst.SimpleString):
                arguments["keywords"][key] = kwarg.value.evaluated_value
            elif isinstance(kwarg.value, (cst.Integer, cst.Float)):
                arguments["keywords"][key] = str(kwarg.value.value)
            elif isinstance(kwarg.value, cst.BooleanOperation):
                arguments["keywords"][key] = "..." # Boolean expression
            else:
                arguments["keywords"][key] = "..."
        
        # Get location
        pos = node.position
        location = Location(pos.line, pos.column) if pos else None
        
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
        return {
            "function_calls": [],
            "function_definitions": [],
            "imports": [],
            "errors": [str(e)]
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