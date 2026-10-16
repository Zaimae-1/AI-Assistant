import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import type { Store } from "./store.js";
import { HttpError } from "./errors.js";

const scrypt = promisify(scryptCallback);
const sessionDurationMs = 30 * 24 * 60 * 60 * 1000;

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  created_at: string;
  updated_at: string;
}

export interface SessionUser {
  id: string;
  email: string;
  display_name: string;
  sessionId: string;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const hash = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt}:${hash.toString("hex")}`;
}

async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [algorithm, salt, hex] = stored.split(":");
  if (algorithm !== "scrypt" || !salt || !hex) return false;
  const expected = Buffer.from(hex, "hex");
  if (expected.length !== 64) return false;
  const actual = (await scrypt(password, salt, expected.length)) as Buffer;
  return timingSafeEqual(actual, expected);
}

function issueSession(store: Store, userId: string): string {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  store.run(
    "INSERT INTO sessions (id,user_id,token_hash,expires_at,created_at) VALUES (?,?,?,?,?)",
    randomUUID(),
    userId,
    sha256(token),
    new Date(now.getTime() + sessionDurationMs).toISOString(),
    now.toISOString(),
  );
  return token;
}

export async function register(
  store: Store,
  email: string,
  password: string,
  displayName: string,
) {
  const normalized = email.trim().toLowerCase();
  if (store.get("SELECT id FROM users WHERE email=?", normalized)) {
    throw new HttpError(409, "email_in_use", "Email is already registered");
  }
  const id = randomUUID();
  const now = new Date().toISOString();
  const passwordHash = await hashPassword(password);
  store.run(
    "INSERT INTO users (id,email,password_hash,display_name,created_at,updated_at) VALUES (?,?,?,?,?,?)",
    id,
    normalized,
    passwordHash,
    displayName.trim(),
    now,
    now,
  );
  return {
    user: { id, email: normalized, display_name: displayName.trim() },
    token: issueSession(store, id),
  };
}

export async function login(store: Store, email: string, password: string) {
  const user = store.get<UserRow>(
    "SELECT * FROM users WHERE email=?",
    email.trim().toLowerCase(),
  );
  const valid = user
    ? await verifyPassword(password, user.password_hash)
    : false;
  if (!user || !valid)
    throw new HttpError(
      401,
      "invalid_credentials",
      "Invalid email or password",
    );
  return {
    user: { id: user.id, email: user.email, display_name: user.display_name },
    token: issueSession(store, user.id),
  };
}

export function authenticate(
  store: Store,
  authorization: string | undefined,
): SessionUser {
  const token = /^Bearer ([A-Za-z0-9_-]{40,})$/.exec(authorization ?? "")?.[1];
  if (!token) throw new HttpError(401, "unauthorized", "Bearer token required");
  const user = store.get<SessionUser>(
    `SELECT u.id,u.email,u.display_name,s.id AS sessionId FROM sessions s
     JOIN users u ON u.id=s.user_id
     WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>?`,
    sha256(token),
    new Date().toISOString(),
  );
  if (!user)
    throw new HttpError(401, "unauthorized", "Session expired or revoked");
  return user;
}

export function logout(store: Store, sessionId: string): void {
  store.run(
    "UPDATE sessions SET revoked_at=? WHERE id=? AND revoked_at IS NULL",
    new Date().toISOString(),
    sessionId,
  );
}
