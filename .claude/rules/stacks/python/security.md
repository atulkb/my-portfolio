---
description: Python security rules (secrets, deserialization, dependency audit). Reusable stack rule.
paths: ['**/*.py', '**/config.py', '**/Dockerfile', '**/requirements.txt']
---

# Security Regulations for AI Pipelines

## Secret Isolation

- **Zero Secret Commitment:** Never hardcode API keys, authorization tokens, or passwords.
- **Environment Variables:** Fetch all infrastructure configurations and runtime secrets using `pydantic-settings` or `os.environ`.
- **Verification:** Always sanitize trace outputs and error frames to ensure token keys are not leaked to log aggregates.

## Ingestion & Deserialization Defense

- **Safe Deserialization:** Never use `pickle.load()` on untrusted or remote artifacts (e.g., model checkpoints, user data uploads).
- **Safe Alternatives:** Use `safetensors` for loading deep learning model weights. Use `json` or safe yaml engines for configs.
- **Prompt Injection Validation:** Treat all LLM user inputs as adversarial. Sanitize text streams prior to embedding them inside critical orchestration or tool-use execution structures.

## Package & Dependency Auditing

- **Pinning:** Explicitly pin absolute versions in `requirements.txt` or `pyproject.toml` to guard against supply chain tampering.
- **Static Scans:** Execute safety audits regularly to capture known vulnerable distributions.

## Concrete Evaluation Commands

- **Scan Secrets:** `detect-secrets scan`
- **Static Application Security Testing:** `bandit -r src/`
- **Audit Dependencies:** `safety check`
