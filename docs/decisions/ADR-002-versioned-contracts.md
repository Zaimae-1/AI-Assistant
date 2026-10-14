# ADR-002: Version the wire protocol

Status: Proposed — 14 October 2026.

Context: Desktop, backend, and local device agent may update at different times.

Decision: Every envelope carries a major/minor protocol version, message ID, correlation ID, timestamp, actor, and payload kind. Major changes may break compatibility; additive optional fields use minor versions. Consumers reject unsupported major versions and unknown command types. Contract tests run from shared JSON Schema fixtures.

Consequences: Requires explicit compatibility policy and fixtures. See [protocol v1](../protocol/protocol-v1.md).
