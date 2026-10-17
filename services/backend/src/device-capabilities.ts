import { z } from "zod";
import { HttpError } from "./errors.js";

const profileId = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const noArguments = z.object({}).strict();

const commandArguments = {
  "git.status": noArguments,
  "git.diff": noArguments,
  "file.read": noArguments,
  "system.info": noArguments,
  "process.list": noArguments,
  "os.lock": noArguments,
  "test.run": z.object({ test_profile_id: profileId }).strict(),
  "terminal.run": z.object({ command_profile_id: profileId }).strict(),
  "app.open": z.object({ app_profile_id: profileId }).strict(),
  "app.close": z.object({ launch_id: z.uuid() }).strict(),
} as const;

export const deviceCapability = z.enum(
  Object.keys(commandArguments) as [
    keyof typeof commandArguments,
    ...(keyof typeof commandArguments)[],
  ],
);

export function isDeviceCapability(
  value: string,
): value is keyof typeof commandArguments {
  return Object.hasOwn(commandArguments, value);
}

export function parseDeviceArguments(
  capability: string,
  value: unknown,
): Record<string, unknown> {
  if (!isDeviceCapability(capability))
    throw new HttpError(
      400,
      "unknown_capability",
      "Device capability is not supported",
    );
  const result = commandArguments[capability].safeParse(value);
  if (!result.success)
    throw new HttpError(
      400,
      "invalid_arguments",
      "Arguments do not match capability",
    );
  return result.data;
}

export function validateDeviceResource(
  capability: string,
  deviceId: string,
  resource: string,
  args: Record<string, unknown>,
): void {
  const expected =
    capability === "system.info" ||
    capability === "process.list" ||
    capability === "os.lock"
      ? `device:${deviceId}`
      : capability === "app.open"
        ? `app:${args.app_profile_id}`
        : capability === "app.close"
          ? `app:${args.launch_id}`
          : null;
  if (expected && resource !== expected)
    throw new HttpError(
      400,
      "invalid_resource",
      "Resource does not match capability arguments",
    );
}
