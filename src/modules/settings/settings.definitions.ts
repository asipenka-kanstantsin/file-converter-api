import { z } from 'zod';

const MB = 1024 * 1024;
const bytes = z
  .number()
  .int()
  .min(1)
  .max(100 * MB);
const pixels = z.number().int().min(16).max(16_384);

// Runtime settings an admin may change without a deploy (decisions A6, F1): key, schema and
// default. A stored value that fails its schema falls back to the default.
export const SETTINGS = {
  'confirmation.login': { default: false, schema: z.boolean() },
  'confirmation.registration': { default: false, schema: z.boolean() },
  // F1: input size limit per source format (Notion: set by the admin per format).
  'convert.maxBytes.csv': { default: 10 * MB, schema: bytes },
  'convert.maxBytes.jpeg': { default: 15 * MB, schema: bytes },
  'convert.maxBytes.json': { default: 10 * MB, schema: bytes },
  'convert.maxBytes.png': { default: 15 * MB, schema: bytes },
  'convert.maxBytes.svg': { default: 15 * MB, schema: bytes },
  'convert.maxBytes.xml': { default: 10 * MB, schema: bytes },
  'convert.maxBytes.yaml': { default: 10 * MB, schema: bytes },
  // F1: the largest raster an SVG may become.
  'convert.svg.maxHeight': { default: 4096, schema: pixels },
  'convert.svg.maxWidth': { default: 4096, schema: pixels },
  // F1/F5: how long history rows and saved results are kept.
  'history.retentionDays': {
    default: 90,
    schema: z.number().int().min(1).max(3650),
  },
} as const satisfies Record<string, { default: unknown; schema: z.ZodType }>;

export type SettingKey = keyof typeof SETTINGS;
export type SettingValue<K extends SettingKey> =
  (typeof SETTINGS)[K]['default'] extends boolean ? boolean : number;
export type Settings = { [K in SettingKey]: SettingValue<K> };

export type FlagKey = {
  [K in SettingKey]: SettingValue<K> extends boolean ? K : never;
}[SettingKey];
export type NumberSettingKey = Exclude<SettingKey, FlagKey>;
