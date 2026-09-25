# AI Simulated Patient — Product-shaped POC

A speech-language pathology clinical-interview platform prototype with student training, exam assessment, optional AI coaching, teacher case management, authentication and server-side persistence.

## Current modes

### Training

- AI Coach is **off by default**
- students can practise completely independently
- Coach can be enabled mid-session without restarting
- when Coach is off, coverage progress is hidden
- final assessment and AI comments are still produced at the end

### Exam

- no Coach
- no live coverage progress
- no hidden case hints
- final scoring only after the interview ends

## Assessment output

The current deterministic mock judge already returns the contract intended for a future structured-output LLM evaluator:

- `covered | partial | missed`
- score / maximum score
- transcript evidence
- question-quality flags
- overall AI comment
- strengths
- improvement priorities
- practice recommendations
- next practice focus

## Production persistence is implemented

With no `DATABASE_URL`, the application remains a zero-setup browser-local Demo.

With `DATABASE_URL`, it switches to PostgreSQL / Neon mode:

- teacher/student login
- HttpOnly session cookie
- teacher account management
- student-safe case listing
- server-side hidden case ground truth
- server-generated interview sessions
- server-side transcript
- server-side revealed-fact state
- server-side evaluations
- teacher centralized record review
- permanent Coach-used audit flag
- frozen case snapshot per interview

See:

- `docs/PRODUCTION_ARCHITECTURE.md`
- `docs/WINDOWS_PRODUCTION.md`
- `db/schema.sql`

## Information-boundary rule

Student-facing data must never reuse teacher/internal diagnostic titles. The production student API exposes only neutral case metadata. Internal diagnosis/etiology, learning goals, rubric and case facts remain server-side.

## LLM provider status

Patient, Coach and Evaluator are still deterministic mock providers so the POC is reproducible.

The next provider step is:

```text
mock patient / coach / evaluator
            ↓
structured OpenAI providers
```

without changing the authentication, session, database or UI contracts.

## Local demo

Node.js 22+:

```bash
npm install
npm run dev
```

Then open `http://localhost:3000`.

Tests:

```bash
npm test
```

This is an educational prototype, not a medical device and not a source of diagnosis or treatment advice.
