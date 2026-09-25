# Architecture

## POC

```text
Browser
  ├─ Student interview UI
  ├─ Teacher case/rubric preview
  └─ localStorage transcript (demo only)
        │
        ▼
Vercel Functions
  ├─ GET  /api/cases
  ├─ POST /api/chat
  └─ POST /api/evaluate
        │
        ▼
Mock providers
  ├─ deterministic case-disclosure engine
  └─ deterministic rubric scorer
```

The mock intentionally keeps **case facts separate from the model/patient surface**. A patient turn receives the current question and the already-revealed fact IDs, then releases only matching facts.

## Production direction

```text
Web App
  │
  ├─ Auth / course / student context
  ▼
Application API
  ├─ Case service (versioned scripts)
  ├─ Interview session service
  ├─ Patient provider interface ──► OpenAI API / other LLM
  └─ Evaluation provider interface ─► structured LLM judge
  │
  ▼
PostgreSQL / Neon
```

Recommended invariants:

1. Case version is frozen when an interview starts.
2. Patient model never receives scoring output or teacher-only feedback.
3. Evaluator gets the final transcript, rubric version and case ground truth.
4. Every score item contains auditable evidence from transcript turns.
5. LLM provider is an adapter, not embedded in UI or domain logic.
6. Do not put model API keys in browser code.
