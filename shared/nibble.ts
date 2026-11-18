import { z } from 'zod';

export const nibbleSchema = z.object({
  budget: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
  rules: z.array(z.string().min(1)).refine(rules => new Set(rules).size === rules.length, 'Duplicate nibble rules'),
  dirtyFilesFirst: z.boolean(),
  wholeFilesFirst: z.boolean(),
  randomSelection: z.boolean(),
}).strict();

export type NibbleConfig = z.infer<typeof nibbleSchema>;

export const defaultNibble: NibbleConfig = {
  budget: null,
  rules: [],
  dirtyFilesFirst: true,
  wholeFilesFirst: true,
  randomSelection: false,
};
