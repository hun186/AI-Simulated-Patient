# Production design direction

The product-shaped POC separates four concerns:

1. Patient provider: controls role-play and permitted disclosure.
2. Assessment tracker: tracks candidate rubric coverage during the interview.
3. Learning coach: provides formative, non-spoiler feedback only in training mode.
4. Final evaluator: reads the complete transcript and returns structured evidence, scores, overall comments and recommendations.

In production, keyword rules should be retained as cheap candidate matching, while the final decision is made by a structured-output LLM semantic classifier/evaluator. Exam mode must not expose hidden case truth, progress or coaching state to the student client.
