import { z } from "zod";

export const Contact = z.object({
  contactId: z.string().min(1),
  userId: z.string().min(1),
  name: z.string().min(1).max(120),
  phoneNumber: z.string().regex(/^\+\d{7,15}$/, "expected E.164"),
  notes: z.string().max(500).nullable(),
});
export type Contact = z.infer<typeof Contact>;
