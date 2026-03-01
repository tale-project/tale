---
description: Python coding standards for Tale services
activationType: glob
patterns:
  - "**/*.py"
---

# Python Standards

## Naming Conventions
- USE snake_case for files, functions, and variables
- Examples: `process_order.py`, `calculate_total()`, `user_data`

## Project Structure
- ORGANIZE code into modules as needed:
  - `routes/` - API endpoints and route handlers
  - `services/` - Business logic and service layer
  - `models/` - Data models and schemas
  - `utils/` - Utility functions and helpers

## Type Hints
- PREFER type hints for function signatures
- Use modern Python typing features

### Example
```python
from typing import List, Optional

def calculate_total(items: List[dict], discount: Optional[float] = None) -> float:
    """Calculate total price with optional discount."""
    subtotal = sum(item["price"] for item in items)
    if discount:
        return subtotal * (1 - discount)
    return subtotal
```

## Code Quality
- Follow PEP 8 style guide
- Use descriptive variable and function names
- Write docstrings for public functions and classes
- Keep functions focused and single-purpose
