import 'dotenv/config';
import { z } from 'zod';

export const configSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
});

export type Config = z.infer<typeof configSchema>;

export const config: Config = configSchema.parse(process.env);
