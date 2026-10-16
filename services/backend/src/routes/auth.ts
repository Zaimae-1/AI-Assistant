import { z } from "zod";
import { login, logout, register } from "../auth.js";
import { assertFound } from "../errors.js";
import { sendJson, type Router } from "../http.js";

const credentials = z
  .object({ email: z.email().max(254), password: z.string().min(12).max(128) })
  .strict();

export function registerAuthRoutes(router: Router): void {
  router.add(
    "POST",
    "/v1/auth/register",
    async (context) => {
      const input = credentials
        .extend({ display_name: z.string().trim().min(1).max(80) })
        .parse(context.body);
      const result = await register(
        context.store,
        input.email,
        input.password,
        input.display_name,
      );
      context.audit(
        result.user.id,
        result.user.id,
        "account.register",
        `user:${result.user.id}`,
        "succeeded",
      );
      sendJson(context.response, 201, result);
    },
    false,
  );

  router.add(
    "POST",
    "/v1/auth/login",
    async (context) => {
      const input = credentials.parse(context.body);
      const result = await login(context.store, input.email, input.password);
      context.audit(
        result.user.id,
        result.user.id,
        "account.login",
        `user:${result.user.id}`,
        "succeeded",
      );
      return result;
    },
    false,
  );

  router.add("POST", "/v1/auth/logout", (context) => {
    logout(context.store, context.user!.sessionId);
    context.audit(
      context.user!.id,
      context.user!.id,
      "account.logout",
      `session:${context.user!.sessionId}`,
      "succeeded",
    );
    return { ok: true };
  });

  router.add("GET", "/v1/me", (context) => ({
    id: context.user!.id,
    email: context.user!.email,
    display_name: context.user!.display_name,
  }));

  router.add("PATCH", "/v1/me", (context) => {
    const input = z
      .object({ display_name: z.string().trim().min(1).max(80) })
      .strict()
      .parse(context.body);
    context.store.run(
      "UPDATE users SET display_name=?,updated_at=? WHERE id=?",
      input.display_name,
      new Date().toISOString(),
      context.user!.id,
    );
    context.audit(
      context.user!.id,
      context.user!.id,
      "profile.update",
      `user:${context.user!.id}`,
      "succeeded",
    );
    return {
      id: context.user!.id,
      email: context.user!.email,
      display_name: input.display_name,
    };
  });

  router.add("GET", "/v1/sessions", (context) =>
    context.store.all(
      "SELECT id,created_at,expires_at,revoked_at FROM sessions WHERE user_id=? ORDER BY created_at DESC",
      context.user!.id,
    ),
  );

  router.add("DELETE", "/v1/sessions/:id", (context) => {
    assertFound(
      context.store.get(
        "SELECT id FROM sessions WHERE id=? AND user_id=?",
        context.params.id,
        context.user!.id,
      ),
      "Session",
    );
    context.store.run(
      "UPDATE sessions SET revoked_at=? WHERE id=?",
      new Date().toISOString(),
      context.params.id,
    );
    context.audit(
      context.user!.id,
      context.user!.id,
      "session.revoke",
      `session:${context.params.id}`,
      "succeeded",
    );
    return { ok: true };
  });
}
