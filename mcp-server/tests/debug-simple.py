#!/usr/bin/env python3
"""
Debug script for analyzing the Python parser issues
"""

import sys
import libcst as cst

# Simple test code
test_code = """
def hello():
    print("Hello, world!")

def add(a, b):
    return a + b

hello()
result = add(2, 3)
print(f"Result: {result}")
"""

# Parse the code
try:
    module = cst.parse_module(test_code)
    print("Successfully parsed module")
    
    # Create a simple visitor to print function definitions
    class DebugVisitor(cst.CSTVisitor):
        def __init__(self):
            super().__init__()
            self.functions = []
            
        def visit_FunctionDef(self, node):
            print(f"Found function: {node.name.value}")
            self.functions.append(node.name.value)
            return True
            
        def visit_Call(self, node):
            if isinstance(node.func, cst.Name):
                print(f"Found function call: {node.func.value}")
            return True
    
    # Visit the module
    visitor = DebugVisitor()
    module.visit(visitor)
    
    print(f"Total functions found: {len(visitor.functions)}")
    print(f"Function list: {visitor.functions}")
    
except Exception as e:
    print(f"Error: {e}")
    import traceback
    traceback.print_exc() 