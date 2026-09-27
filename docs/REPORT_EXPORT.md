# Interview Record Report Export

Status: implemented in PR #23.

## Purpose

Teacher/Admin users can export a completed interview record as:

- a real Word `.docx` OpenXML document;
- an A4 browser print view that can be saved as PDF.

Both outputs use the same report model and the same persisted session evidence.

## Report contents

The report includes:

1. Respondent/student name.
2. Teacher information.
3. Case, mode, start/end time, duration, and session ID.
4. Full timestamped student/patient transcript.
5. AI Coach training feedback saved during the session.
6. Patient / Coach / Evaluator Provider + Model from the session route snapshot.
7. Actual LLM call count, token usage, and available estimated cost from usage events.
8. Final score and overall feedback.
9. Strengths, improvements, recommendations, and next-practice focus.
10. Full rubric item status, score, reasoning, and transcript evidence.

No Provider API keys, encrypted secret fields, or Provider session secrets are included in exports.

## Teacher history

Schema version 9 adds `teacher_snapshot` to `interview_sessions`.

For new sessions, the Teacher assignment known when the session begins is snapshotted so a later reassignment does not change the historical report.

Older sessions have the migration default `[]`. When a historical snapshot is unavailable, the Teacher records API falls back to the current Teacher assignment and exposes:

```
teacherSource = current_assignment
```

The report explicitly labels this as **current assignment / not a historical snapshot**.

## AI Coach history

Schema version 9 adds `interview_coach_events`.

Each successful Coach response is persisted with the returned teaching payload, including the relevant student question, question-quality feedback, next hint, reflection prompt, progress, Provider, and Model when available.

Older sessions may have `coachUsed=true` without historical per-turn Coach events. Reports explicitly state that the older record did not retain those per-turn details.

## LLM provenance

Reports use two distinct sources:

- `llm_route_snapshot` for the Provider / Model selected for Patient, Coach, and Evaluator when the session was created;
- `llm_usage_events` for actual calls, tokens, failures, and pricing snapshots.

Unpriced providers remain unpriced. The report must not invent a cost.

## Word implementation

`report-export.js` creates a real DOCX OpenXML package in the browser.

It does not upload report data to a third party and does not require a server-side Word library.

## PDF implementation

PDF export uses the same styled HTML report and opens the browser-native print flow with A4 print CSS.

The user chooses **Save as PDF / 另存為 PDF** in the system print dialog.

This design is intentional because it:

- preserves Traditional Chinese through the browser/OS font stack;
- avoids shipping a large CJK font in the repository;
- avoids Chromium/Puppeteer or a PDF engine on the server;
- works across Windows/Linux server deployments because rendering is performed by the user's browser.

## Vercel Demo

`report-export.js` is included in the Vercel static whitelist so browser-local demo records can use the same export UI.

Production Teacher records/database APIs remain excluded from the Vercel Demo bundle.

## Future technical documentation / operation manual

When the full documentation is written, include:

- where Word/PDF buttons appear in Teacher records;
- PDF Save-as-PDF instructions for major browsers;
- the difference between Teacher session snapshot and current-assignment fallback;
- the limitation for old sessions that did not retain per-turn Coach feedback;
- LLM Provider/Model and cost provenance rules;
- privacy guidance for exported student records.
