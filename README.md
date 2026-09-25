# AI Simulated Patient — Product-shaped POC

A lightweight teaching prototype for speech-language pathology clinical-interview training.

## Student modes

- **Training mode**: AI learning coach gives formative feedback after each turn, including question-quality feedback and a non-spoiler next-step hint.
- **Exam mode**: hides progress and coaching; only produces summative feedback after the interview.

## Assessment contract

The POC evaluator already returns the structure intended for a future LLM judge:

- `covered | partial | missed`
- per-item score and evidence quote
- question-quality flags
- overall AI comment
- strengths
- improvement priorities
- practice recommendations
- next practice focus

The current implementation is deterministic (`mock-semantic-judge`) so demonstrations remain repeatable. Production can replace the provider with an OpenAI structured-output evaluator without changing the UI contract.

## Teacher console

Teachers can create browser-local cases with patient profile, student-visible brief, learning goals, controlled facts, disclosure triggers and rubric points. Completed sessions are archived locally with transcript, mode, scores, evidence and overall feedback.

## Production path

1. Move case definitions, rubrics, sessions and transcripts to PostgreSQL / Neon.
2. Add teacher/student authentication and authorization.
3. Replace `mock-patient` with a real Patient LLM provider.
4. Keep deterministic candidate matching as a fast first pass, then use an LLM semantic classifier.
5. Replace `mock-semantic-judge` with a structured-output final LLM evaluator over the complete transcript.
6. Persist model version, prompt version, case version, rubric version and evidence for auditability.

Run locally with Node.js 22+: `npm run dev`. Tests: `npm test`.

This is an educational prototype, not a medical device and not a source of diagnosis or treatment advice.


## Information-boundary rule

Student-facing case data must never reuse teacher/internal diagnostic titles. The public case endpoint exposes only a neutral student label, a neutral encounter brief, basic patient demographics and the patient's opening line. Internal diagnosis/etiology, learning goals, rubric and ground truth remain teacher/evaluator data. In production the teacher endpoint must be protected by role-based authentication.
