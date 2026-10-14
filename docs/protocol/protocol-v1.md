# Jarvis Protocol v1 (draft)

Source: [Notion roadmap, Phase 2](https://app.notion.com/p/3eb499df915c81d5b31fd0f25bb770af). This contract describes planned messages; it does not imply transport or runtime implementation.

## Envelope

Every event and command is a JSON object validated by [envelope.schema.json](../../core/protocol/schemas/envelope.schema.json). Required fields: `protocol_version`, `message_id`, `correlation_id`, `sent_at` (UTC ISO 8601), `source`, `type`, and `payload`. A `task_id` is present for task-bound activity. The `source` is authenticated separately; a client-provided source string is never proof of identity.

IDs are opaque UUIDs. A correlation ID connects request, progress, and result. `message_id` is unique per envelope. `idempotency_key` is required on commands. Receivers store command outcome for the key and return it on redelivery instead of executing again.

## Event catalog

| Type | Payload | Producer |
| --- | --- | --- |
| `message.created` | Conversation ID, sender, content, optional reply/target | Backend |
| `task.updated` | Task ID, state, attempt, optional progress/error | Backend/Orchestrator |
| `permission.requested` | Request ID, task/device, capability, resource, risk, expiry | Backend |
| `permission.decided` | Request ID, decision, approver, expiry/nonce | Backend |
| `device.command.result` | Command ID, status, sanitized output/error | Local Agent |

Events are observations. They never authorize an action by themselves.

## Command catalog

The envelope and task, message, permission, and device contracts are domain-neutral. The initial `device.command.requested` capability catalog (`git.status`, `git.diff`, `test.run`) is a **developer example**, not the definition of Jarvis or a product-wide MVP choice. Other work, study, and personal capabilities require their own reviewed schemas. A command contains target device, task, resource scope, arguments, expiry, idempotency key, and approval reference when required. The Local Agent rejects unknown capabilities, expired commands, wrong device, out-of-scope resources, revoked grants, or unsupported versions.

No generic shell command is defined in v1. `test.run` identifies a configured test profile ID, not an arbitrary command string from the model. Pull, commit, and conflict resolution are not command types in this draft; they require their own reviewed contract before implementation.

## Lifecycle and errors

```text
task.updated: proposed → awaiting_approval → queued → running
                                      └──────────────→ cancelled
running → succeeded | failed | cancelled
```

The state transition validator must reject transitions from terminal states. A disconnect after dispatch produces an uncertain execution record until the agent reports or reconciliation proves the outcome. Error codes: `UNSUPPORTED_VERSION`, `UNKNOWN_TYPE`, `INVALID_PAYLOAD`, `PERMISSION_DENIED`, `SCOPE_VIOLATION`, `EXPIRED`, `DEVICE_UNAVAILABLE`, `EXECUTION_FAILED`. Public error details exclude credentials and raw private file content.

## Version policy

Version is `major.minor`. v1.0 readers accept additional optional payload fields from newer v1 minors, but reject missing required fields, unknown commands, and all v2 messages. A new required field, renamed field, changed meaning, or changed permission semantics requires v2. For an additive field, sender uses a higher minor and maintains v1.0 behavior when absent. Clients announce supported major/minor versions at session start; backend selects the highest mutually supported version. Until negotiation exists, v1.0 is the only accepted version.

Old clients remain supported for at least one release window after a new major is introduced; exact duration must be set with release cadence. The backend must reject unsupported versions with a structured error rather than silently reinterpret fields.

## Contract verification

Run `npm test` in `core/protocol`. Tests validate accepted event/command fixtures and reject missing identifiers, unknown command types, invalid permissions, and unsupported versions. Runtime services still need their own transition, replay, device authentication, and permission integration tests.
