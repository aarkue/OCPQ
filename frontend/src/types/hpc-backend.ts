import { z } from "zod";

export const connectionFormSchema = z.object({
  username: z.string().min(1, "Please enter a username."),
  host: z.tuple([
    z.string(),
    z
      .string()
      .transform((value) => (value === "" ? null : value))
      .nullable()
      .optional()
      .refine((value) => value === null || !isNaN(Number(value)), {
        message: "Invalid number",
      })
      .transform((value) => (value === null ? 22 : Number(value)))
      .or(z.number().int().positive()),
  ]),
  auth: z.discriminatedUnion("mode", [
    z.object({
      mode: z.literal("password-mfa"),
      password: z.string(),
      mfaCode: z.string(),
    }),
    z.object({
      mode: z.literal("ssh-key"),
      path: z.string(),
      passcode: z.string().optional(),
    }),
  ]),
});

export type ConnectionConfig = z.infer<typeof connectionFormSchema>;

export type JobStatus =
  | { status: "PENDING"; start_time: String | undefined }
  | {
      status: "RUNNING";
      start_time: String | undefined;
      end_time: String | undefined;
    }
  | { status: "ENDED"; state: string }
  | { status: "NOT_FOUND" };
