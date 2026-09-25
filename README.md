# AI Simulated Patient — Zero-config POC

A lightweight proof of concept for speech-language pathology students to practice clinical interviewing with an AI simulated patient.

This version deliberately uses **Mock LLM providers**, so it can be demonstrated without an OpenAI API key or database.

## What works

- One aphasia-oriented simulated-patient case.
- Patient information is revealed progressively according to question triggers.
- Student/patient transcript is kept in browser `localStorage` for the demo.
- End-of-interview rubric scoring and feedback.
- Teacher-facing preview of the case-script idea and rubric.
- Vercel-compatible `/api` serverless functions.
- No runtime npm dependencies.

## Local demo

Requires Node.js 22+.

```bash
npm run dev
```

Open `http://localhost:3000`.

Run tests:

```bash
npm test
```

## Deploy to Vercel

1. Push this folder to a GitHub repository.
2. In Vercel, create a new project and import that repository.
3. Framework preset can be left as **Other**; no build command is needed.
4. Deploy.

The POC requires no secrets because `LLM_PROVIDER=mock` is the default design.

## Next implementation step

Replace the mock provider behind `/api/chat` and `/api/evaluate`, rather than changing the UI flow:

- `MockPatientProvider` → `OpenAIPatientProvider`
- `MockEvaluator` → structured OpenAI evaluator
- browser `localStorage` → server-side interview sessions in PostgreSQL / Neon

`db/schema.sql` contains a starting production schema.

## Important scope note

This repository is a teaching-system prototype, not a medical device and not a source of diagnosis or treatment advice.
