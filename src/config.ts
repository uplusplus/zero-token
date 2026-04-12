import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

// ── Config Schema ──

const BrowserProfileSchema = z.object({
  name: z.string(),
  /** Path to Chrome/Chromium executable. Auto-detected if omitted. */
  executable: z.string().optional(),
  /** Path to user data directory for persistent sessions */
  userDataDir: z.string().optional(),
  /** CDP port for remote debugging */
  cdpPort: z.number().default(9333),
  /** Launch mode */
  mode: z.enum(["launch", "headless", "attach"]).default("launch"),
});

const ProviderConfigSchema = z.object({
  /** Provider id: deepseek-web, claude-web, chatgpt-web, etc. */
  id: z.string(),
  /** Whether this provider is enabled */
  enabled: z.boolean().default(true),
  /** Browser profile to use (references a profile name) */
  profile: z.string().optional(),
  /** Auth data (JSON string with cookies/session keys) */
  auth: z.string().optional(),
  /** Override available models */
  models: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        reasoning: z.boolean().default(false),
        contextWindow: z.number().default(32000),
        maxTokens: z.number().default(4096),
      }),
    )
    .optional(),
});

const ServerConfigSchema = z.object({
  host: z.string().default("0.0.0.0"),
  port: z.number().default(8080),
});

export const ConfigSchema = z.object({
  server: ServerConfigSchema,
  browser: z.object({
    defaultProfile: z.string().default("default"),
    profiles: z.record(z.string(), BrowserProfileSchema).default({
      default: {
        name: "default",
        cdpPort: 9333,
        mode: "launch",
      },
    }),
  }),
  providers: z.array(ProviderConfigSchema),
});

export type Config = z.infer<typeof ConfigSchema>;
export type BrowserProfile = z.infer<typeof BrowserProfileSchema>;
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

// ── Loader ──

const DEFAULT_CONFIG_PATH = resolve(process.cwd(), "config.yaml");

export function loadConfig(configPath?: string): Config {
  const filePath = configPath ?? process.env.ZTS_CONFIG ?? DEFAULT_CONFIG_PATH;

  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch {
    console.warn(`[config] No config file found at ${filePath}, using defaults`);
    return ConfigSchema.parse({
      providers: [],
    });
  }

  const parsed = parseYaml(raw);
  const result = ConfigSchema.safeParse(parsed);

  if (!result.success) {
    console.error("[config] Invalid configuration:");
    for (const issue of result.error.issues) {
      console.error(`  ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }

  return result.data;
}
