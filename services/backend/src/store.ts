import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

type Value = string | number | bigint | null | Uint8Array;

export class Store {
  readonly db: DatabaseSync;

  constructor(path = ":memory:") {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA foreign_keys = ON");
    if (path !== ":memory:") this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
        display_name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), token_hash TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL, revoked_at TEXT, created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL,
        role TEXT NOT NULL, instructions TEXT NOT NULL DEFAULT '', model TEXT,
        status TEXT NOT NULL DEFAULT 'idle', memory_enabled INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
      );
      CREATE TABLE IF NOT EXISTS agent_groups (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL,
        project_context TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS group_members (
        group_id TEXT NOT NULL REFERENCES agent_groups(id) ON DELETE CASCADE,
        agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        PRIMARY KEY(group_id, agent_id)
      );
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), title TEXT NOT NULL,
        agent_id TEXT REFERENCES agents(id), group_id TEXT REFERENCES agent_groups(id),
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), conversation_id TEXT NOT NULL REFERENCES conversations(id),
        sender_kind TEXT NOT NULL, sender_id TEXT NOT NULL, target_agent_id TEXT,
        reply_to_id TEXT, content TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS messages_conversation ON messages(conversation_id, created_at);
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '', conversation_id TEXT REFERENCES conversations(id),
        agent_id TEXT REFERENCES agents(id), state TEXT NOT NULL, progress INTEGER NOT NULL DEFAULT 0,
        result TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS workflows (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), task_id TEXT NOT NULL REFERENCES tasks(id),
        steps_json TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS workflow_runs (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), task_id TEXT NOT NULL REFERENCES tasks(id),
        idempotency_key TEXT NOT NULL, result_json TEXT NOT NULL, created_at TEXT NOT NULL,
        UNIQUE(task_id,idempotency_key)
      );
      CREATE TABLE IF NOT EXISTS task_handoffs (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
        task_id TEXT NOT NULL REFERENCES tasks(id), source_agent_id TEXT NOT NULL REFERENCES agents(id),
        target_agent_id TEXT NOT NULL REFERENCES agents(id), hop_number INTEGER NOT NULL,
        reason TEXT NOT NULL, created_at TEXT NOT NULL,
        UNIQUE(task_id,hop_number)
      );
      CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL,
        platform TEXT NOT NULL, capabilities_json TEXT NOT NULL, last_seen TEXT NOT NULL,
        revoked_at TEXT, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS permission_requests (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), task_id TEXT NOT NULL REFERENCES tasks(id),
        device_id TEXT NOT NULL REFERENCES devices(id), agent_id TEXT REFERENCES agents(id),
        capability TEXT NOT NULL, resource TEXT NOT NULL, risk INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending', expires_at TEXT NOT NULL,
        nonce_hash TEXT, consumed_at TEXT, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS permission_policies (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), agent_id TEXT,
        device_id TEXT, capability TEXT NOT NULL, resource TEXT NOT NULL,
        decision TEXT NOT NULL, expires_at TEXT, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), actor_kind TEXT NOT NULL,
        actor_id TEXT NOT NULL, action TEXT NOT NULL, resource TEXT NOT NULL,
        result TEXT NOT NULL, details_json TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS audit_user_time ON audit_events(user_id, created_at);
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), agent_id TEXT NOT NULL REFERENCES agents(id),
        content TEXT NOT NULL, source_message_id TEXT REFERENCES messages(id),
        expires_at TEXT, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS usage_events (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), agent_id TEXT NOT NULL REFERENCES agents(id),
        model TEXT NOT NULL, input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL,
        estimated_cost_micros INTEGER, created_at TEXT NOT NULL
      );
    `);
    const agentColumns = this.all<{ name: string }>(
      "PRAGMA table_info(agents)",
    );
    if (!agentColumns.some((column) => column.name === "deleted_at")) {
      this.db.exec("ALTER TABLE agents ADD COLUMN deleted_at TEXT");
    }
  }

  get<T>(sql: string, ...params: Value[]): T | undefined {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }

  all<T>(sql: string, ...params: Value[]): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }

  run(sql: string, ...params: Value[]): void {
    this.db.prepare(sql).run(...params);
  }

  transaction<T>(work: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }
}
