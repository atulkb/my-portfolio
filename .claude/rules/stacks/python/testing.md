---
description: Testing standards, mocking practices, and verification suites for AI workflows
paths: ['**/test_*.py', '**/*_test.py', 'tests/**/*.py']
---

# Testing Standards for AI Workflows

## Framework & Environment

- **Test Runner:** Use `pytest` for all unit and integration verifications.
- **Deterministic Runs:** Seed all pseudo-random number generators (`random`, `numpy`, `torch`) at the fixture level to ensure deterministic output.

## AI Test Specifics

- **No Real API Hits:** Never make real network requests to external LLM providers (e.g., OpenAI, Anthropic) during unit tests. Use `unittest.mock` or `pytest-mock` to patch API clients.
- **Fixture Strategy:** Use lightweight mock arrays or small subsets of local data instead of loading large corporate datasets or real weights (>50MB) into test memory.
- **Deterministic Evaluation:** For heuristic or probabilistic outputs, test via structural assertions (e.g., verifying bounding box boundaries, output sequence length, or tensor shapes) instead of exact string matching.

## Concrete Commands

- **Run Unit Tests:** `pytest tests/unit -v`
- **Run Regression Tests:** `pytest tests/regression --durations=0`
- **Check Coverage:** `pytest --cov=src --cov-report=term-missing`

## Test Structure Pattern

```python
import pytest
import numpy as np

@pytest.fixture
def stable_seed():
    np.random.seed(42)

def test_preprocess_pipeline(stable_seed):
    # Arrange
    mock_input = np.random.rand(2, 100)

    # Act
    result = transform_features(mock_input)

    # Assert
    assert result.shape == (2, 50)
    assert not np.isnan(result).any()
```
