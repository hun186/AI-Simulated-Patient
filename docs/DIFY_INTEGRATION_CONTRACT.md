# Dify Integration Contract and Follow-up Plan

Status: design record for the current Dify provider work and the required stateful Chatflow follow-up.

## Why this document exists

The platform supports Dify as an AI Provider in the same routing layer as OpenAI, DeepSeek, Ollama, and Custom providers. A collaborator already has a Dify Chatflow that keeps scoring state such as `H01_done ... H14_done` in Dify Conversation Variables.

The current Dify provider implementation and the collaborator's existing Chatflow use different state-ownership models. This document records the compatibility requirement so it is not lost when the technical documentation and operation manual are written later.

## State ownership

The platform remains authoritative for:

- user identity and role;
- selected case and interview session;
- canonical transcript;
- Patient / Coach / Evaluator route snapshot;
- persisted assessment result;
- usage/audit records.

Dify may hold provider-specific conversational state for a Dify Chat/Chatflow route.

Provider-specific Dify state must be treated as subordinate external state, not as the platform's source of truth.

## Two supported Dify execution modes

### 1. Platform-managed / stateless Dify

This is the first implementation.

- The platform sends the required system prompt and transcript/context on each call.
- Dify does not need prior conversation continuity.
- The platform remains the only conversation store.
- Appropriate for Dify Workflow, Completion, or Chat/Chatflow apps that do not depend on Conversation Variables.

### 2. Stateful Dify Chatflow

Required follow-up for compatibility with the collaborator's existing Chatflow.

- The first Dify Chat/Chatflow request starts with an empty `conversation_id`.
- The returned Dify `conversation_id` is saved as provider state for that interview session and Dify route.
- Every subsequent request in the same interview reuses the same `conversation_id`.
- Dify Conversation Variables may therefore accumulate state such as `H01_done ... H14_done`.
- The platform still stores the canonical transcript and assessment independently.
- A new interview session must not reuse an old Dify `conversation_id`.

Recommended conceptual session state:

```
Interview Session
├─ canonical transcript
├─ route snapshot
├─ persisted assessment
└─ provider state
   └─ Dify
      └─ conversation_id
```

The provider-state representation may later support other external providers and should not expose API keys or other secrets.

## Dify Chatflow request contract

For a stateful Chat/Chatflow route:

First turn:

```json
{
  "query": "學生本輪訊息",
  "conversation_id": "",
  "user": "stable opaque platform user/session identifier"
}
```

Later turns:

```json
{
  "query": "學生本輪訊息",
  "conversation_id": "<saved Dify conversation id>",
  "user": "same stable opaque identifier"
}
```

The server-side platform, never browser JavaScript, supplies the Dify API key.

## End-of-interview trigger

For the collaborator's current Chatflow, the platform should support a configurable final trigger, with the initial default:

```
問診結束
```

When the learner presses the platform's **End interview / view result** action, the Dify stateful route may send the configured trigger with the same `conversation_id`.

This preserves a Dify flow such as:

```
IF query == "問診結束"
  -> final assessment flow
ELSE
  -> patient reply + incremental H01-H14 state update
```

The trigger text must be route configuration rather than a hard-coded global constant so future Dify apps can use a different contract.

## Normal Patient response

For ordinary interview turns, Dify does not need to wrap the patient response in a custom frontend envelope.

The platform adapter can consume the normal Dify `answer` field and expose it as the Patient reply.

Example Dify answer:

```
大概半年多了，一開始只是偶爾沙啞，後來越來越明顯。
```

The platform remains responsible for the chat UI.

## Final assessment contract

The collaborator's older suggested JSON shape:

```
score
total
completed_items
missing_items
strengths
priority_improvements
practice_suggestions
next_focus
```

must not become a second platform assessment schema.

Dify final output should instead conform to the platform's existing Evaluator contract:

```json
{
  "totalScore": 11,
  "maxScore": 14,
  "percentage": 78.6,
  "items": [
    {
      "id": "H01",
      "criterion": "主訴",
      "status": "covered",
      "score": 1,
      "maxScore": 1,
      "evidence": [
        {
          "turn": 2,
          "quote": "你的聲音主要有什麼困擾？"
        }
      ],
      "reasoning": "學生有明確詢問主要嗓音困擾。"
    }
  ],
  "overall": {
    "comment": "整體評語",
    "strengths": [],
    "improvements": [],
    "recommendations": [],
    "nextPracticeFocus": "下一次優先練習重點"
  }
}
```

Allowed item statuses remain:

- `covered`
- `partial`
- `missed`

Dify Evaluator output must still pass the platform evaluator contract validation and existing repair path. The platform should not add a separate Dify-only assessment renderer.

## Route configuration expected for stateful Chatflow

A future Dify route should be able to configure at least:

- execution mode: `platform_managed` or `stateful_chatflow`;
- Dify app type: `chat`, `workflow`, or `completion`;
- Workflow input key;
- Workflow output key;
- fixed Dify inputs JSON;
- end-of-interview trigger text;
- whether the final trigger is enabled for that route.

A Dify Workflow route normally remains stateless unless the workflow itself exposes another explicit external-state contract.

## Security requirements

- Dify App API keys stay server-side and encrypted at rest.
- API keys must never be returned to the browser.
- `conversation_id` is not a credential, but should still be scoped to one platform interview session.
- A Teacher may use the official Dify endpoint or allowed private/local self-hosted endpoints under the platform endpoint-safety policy.
- Vercel Demo remains read-only and must not store Dify credentials or call Dify.

## Responsibility split

### Platform

- login / roles;
- case selection;
- student/teacher records;
- interview session lifecycle;
- canonical transcript;
- route selection;
- Provider credentials;
- end-interview button;
- final assessment persistence;
- result UI;
- usage/audit;
- evaluator contract validation/repair.

### Dify

Depending on the selected Dify app:

- Patient response workflow;
- optional incremental H01-H14 evaluation;
- Conversation Variables;
- workflow branching;
- LLM execution configured inside Dify;
- final assessment generation conforming to the platform Evaluator contract.

## Compatibility guidance for the collaborator

The collaborator does not need to redesign the Dify Chatflow merely to match the platform's stateless mode.

For an existing Chatflow that already accumulates `H01_done ... H14_done`:

1. keep those Conversation Variables;
2. continue accepting Dify `conversation_id`;
3. keep the existing end trigger if desired;
4. change the final output to the platform Evaluator JSON contract;
5. expose a normal published Dify Application API and App API key;
6. provide any required fixed input names to the platform route configuration.

## Documentation/manual TODO

When full documentation is requested later, ensure this design is incorporated into both documents.

### Technical documentation must include

- provider architecture and state ownership;
- stateless vs stateful Dify mode;
- `conversation_id` lifecycle;
- provider-state persistence;
- Dify endpoint/app-type mapping;
- Workflow input/output mapping;
- final trigger behavior;
- Evaluator JSON contract;
- token/cost accounting limitations;
- security and Vercel Demo behavior;
- failure/retry behavior.

### Teacher/Admin operation manual must include

- how to create a Dify Provider connection;
- where to obtain a Dify App API key;
- how to select Chat/Chatflow, Workflow, or Completion;
- how to enter self-hosted Dify Base URL;
- how to select Dify for Patient / Coach / Evaluator;
- how to configure Workflow input/output fields;
- how to choose Platform-managed vs Stateful Chatflow;
- how to configure the end-of-interview trigger;
- how to test a Dify connection;
- how to interpret connection/evaluation errors;
- a worked example for a stateful H01-H14 Chatflow.

## Implementation status

- Dify Provider Phase 1: implemented on PR #22 branch.
- Stateful Chatflow / persisted `conversation_id`: implemented and covered by end-to-end tests on PR #22.
- Provider state is persisted per `(interview_session, connection)` in `llm_provider_session_state` (SQLite schema v8; PostgreSQL adapter schema retained in `db/schema.sql`).
- Patient calls create/reuse the Dify `conversation_id`; an Evaluator route using the same Dify connection can send a configurable final trigger (default `問診結束`) into the same conversation.
- A new interview session starts without the prior session's Dify conversation state.
- PostgreSQL/Neon connectivity is not required for this feature; the existing PostgreSQL adapter path remains available for future durable deployments.
