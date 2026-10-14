# ADR-003: Bind approval to a concrete action

Status: Proposed — 14 October 2026.

Context: A generic "allow Jarvis" prompt is insufficient when tasks can act on files, commands, or other devices.

Decision: Approval identifies user, task, device, capability, canonical resource, risk, expiry, and nonce. Backend records the decision; Local Agent verifies a valid grant before running. High-risk actions require separate confirmation. Tool outputs and agent messages cannot issue approvals.

Consequences: Planned actions must be concrete before approval. Changed parameters require a new approval. See [system design](../architecture/phase-1-system-design.md).
