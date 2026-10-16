---
description: Coding standards and style guidelines for Python AI/ML development
paths: ['**/*.py']
---

# Python AI Code Style Guidelines

## Core Principles

- **Readability Over Cleverness:** Write clear, explicit Python code following PEP 8.
- **Type Safety:** Enforce static typing across the codebase to ensure data shape consistency in pipelines.

## Coding Standards

- **Python Target:** Use Python 3.10+ syntax features (e.g., structural pattern matching, native type union operator `|`).
- **Formatting:** Adhere strictly to `black` formatter layout and `isort` for import sorting.
- **Naming Conventions:**
  - Variables/Functions: Use `snake_case`. Use explicit domain terms (e.g., `token_ids`, `embedding_matrix` instead of `x`, `y`).
  - Classes: Use `PascalCase` (e.g., `DataPreprocessor`, `TransformerLayer`).
  - Constants: Use `UPPER_CASE_SNAKE` (e.g., `MAX_SEQ_LEN = 512`).

## Type Hinting & Type Safety

- **Explicit Hints:** Every function signature must contain complete type hints for arguments and return types.
- **Generics:** Use `typing` generics (`Mapping`, `Sequence`) instead of concrete structures (`dict`, `list`) for function arguments.
- **Tensor Shapes:** Annotate tensor shapes in comments or via TypeForm/Jaxtyping where possible:
  ```python
  def compute_loss(embeddings: Float[Tensor, "batch seq_len d_model"]) -> Float[Tensor, ""]:
      ...
  ```

## Documentation

- **Docstrings:** All public modules, classes, and functions require Google-style docstrings.
- **Mathematical Reference:** Include the mathematical formulations or papers (with URLs) in the docstring if implementing custom algorithms or loss functions.
- **Shape Tracking:** Explicitly document the structural evolution of matrices/tensors through complex data transforms.
