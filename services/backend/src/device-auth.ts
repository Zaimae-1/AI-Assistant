import { createHash, randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { HttpError } from "./errors.js";
import type { Store } from "./store.js";

const digest = (token: string) =>
  createHash("sha256").update(token).digest("hex");

export function issueDeviceToken(store: Store, deviceId: string): string {
  const token = randomBytes(32).toString("base64url");
  store.run(
    "UPDATE devices SET token_hash=? WHERE id=?",
    digest(token),
    deviceId,
  );
  return token;
}

export function authenticateDevice(
  store: Store,
  request: IncomingMessage,
  deviceId: string,
) {
  const token = /^Bearer ([A-Za-z0-9_-]{40,})$/.exec(
    request.headers.authorization ?? "",
  )?.[1];
  if (!token)
    throw new HttpError(401, "device_unauthorized", "Device token required");
  const device = store.get<{
    id: string;
    user_id: string;
    revoked_at: string | null;
  }>(
    "SELECT id,user_id,revoked_at FROM devices WHERE id=? AND token_hash=?",
    deviceId,
    digest(token),
  );
  if (!device || device.revoked_at) {
    throw new HttpError(
      401,
      "device_unauthorized",
      "Device token invalid or revoked",
    );
  }
  return device;
}
