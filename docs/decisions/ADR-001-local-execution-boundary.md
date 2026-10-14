# ADR-001: Separate planning from local execution

Status: Proposed — 14 October 2026.

Context: Jarvis will read repositories and eventually control devices. A model response is untrusted and may contain instructions from repository content or tool output.

Decision: Orchestrator plans and requests named capabilities. A device-bound Local Agent executes only registered tools within the selected project and checks authorization at execution time. No model-generated free-form shell command runs by default.

Consequences: More protocol and permission work up front; narrower but testable MVP. Execution remains possible when the AI provider changes. Review this decision after a user-tested workflow.
