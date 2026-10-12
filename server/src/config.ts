import 'dotenv/config';
import { z } from 'zod';

const DEV_SECRET = 'dev-only-secret-change-me-please';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  DATABASE_URL: z.string().optional(),
  PGLITE_DIR: z.string().default('./data/pgdata'),
  JWT_SECRET: z.string().min(16).default(DEV_SECRET),
  WEB_DIST: z.string().default('../web/dist'),

  DEMO_MODE: z.enum(['true', 'false']).default('true'),
  SEED_AUTHOR_PASSWORD: z.string().min(6).default('bookleaf123'),
  SEED_ADMIN_PASSWORD: z.string().min(6).default('admin123'),
  APP_TODAY: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),

  LLM_PROVIDERS: z.string().default('gemini,groq'),
  GROQ_API_KEY: z.string().optional(),
  GROQ_MODEL_FAST: z.string().default('openai/gpt-oss-20b'),
  GROQ_MODEL_DRAFT: z.string().default('openai/gpt-oss-120b'),
  GROQ_REASONING_EFFORT: z.string().default('low'),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL_FAST: z.string().default('gemini-3.5-flash-lite'),
  GEMINI_MODEL_DRAFT: z.string().default('gemini-3.5-flash-lite'),
  GEMINI_THINKING_BUDGET: z.string().default('0'),
  LLM_TIMEOUT_MS: z.coerce.number().int().default(20000),
  LLM_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  LLM_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
  LLM_DAILY_CAP: z.coerce.number().int().positive().default(500),
  LLM_ENABLED: z.enum(['true', 'false']).default('true'),
});

export type Config = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  const e = parsed.data;
  if (e.NODE_ENV === 'production' && e.JWT_SECRET === DEV_SECRET) {
    throw new Error('JWT_SECRET must be set to a unique value in production.');
  }
  return {
    env: e.NODE_ENV,
    isProd: e.NODE_ENV === 'production',
    port: e.PORT,
    databaseUrl: e.DATABASE_URL || undefined,
    pgliteDir: e.PGLITE_DIR,
    jwtSecret: e.JWT_SECRET,
    webDist: e.WEB_DIST,
    demoMode: e.DEMO_MODE === 'true',
    seedAuthorPassword: e.SEED_AUTHOR_PASSWORD,
    seedAdminPassword: e.SEED_ADMIN_PASSWORD,
    appToday: e.APP_TODAY || undefined,
    llm: {
      providers: e.LLM_PROVIDERS.split(',').map((s) => s.trim()).filter(Boolean),
      timeoutMs: e.LLM_TIMEOUT_MS,
      maxRetries: e.LLM_MAX_RETRIES,
      concurrency: e.LLM_CONCURRENCY,
      dailyCap: e.LLM_DAILY_CAP,
      enabled: e.LLM_ENABLED === 'true',
      groq: {
        apiKey: e.GROQ_API_KEY || undefined,
        modelFast: e.GROQ_MODEL_FAST,
        modelDraft: e.GROQ_MODEL_DRAFT,
        reasoningEffort: e.GROQ_REASONING_EFFORT,
      },
      gemini: {
        apiKey: e.GEMINI_API_KEY || undefined,
        modelFast: e.GEMINI_MODEL_FAST,
        modelDraft: e.GEMINI_MODEL_DRAFT,
        thinkingBudget: e.GEMINI_THINKING_BUDGET,
      },
    },
  };
}

/** Returns today's date as YYYY-MM-DD (UTC), honouring APP_TODAY for reproducible demos/tests. */
export function todayISO(config: Pick<Config, 'appToday'>): string {
  return config.appToday ?? new Date().toISOString().slice(0, 10);
}
