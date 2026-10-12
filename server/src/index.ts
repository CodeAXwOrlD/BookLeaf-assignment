import { createLlm } from './ai/llm';
import { resumePendingTriage } from './ai/triage';
import { buildApp } from './app';
import { loadConfig, todayISO } from './config';
import type { Ctx } from './context';
import { createDb } from './db';
import { Hub } from './realtime/hub';
import { seedIfEmpty } from './seed/seed';

async function main() {
  const config = loadConfig();
  const db = await createDb(config);
  const hub = new Hub();
  const llm = createLlm(config.llm);
  const [todayUsage] = await db.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM ai_usage WHERE created_at >= (now() AT TIME ZONE 'UTC')::date`
  ).catch(() => [{ count: 0 }]);
  llm.setTodayCalls(todayUsage?.count ?? 0);

  const ctx: Ctx = {
    config, db, llm, hub,
    today: () => todayISO(config),
    log: console as any, // replaced by the Fastify logger below
  };
  const app = await buildApp(ctx, { logger: true });
  ctx.log = app.log as any;

  await seedIfEmpty(ctx);
  await resumePendingTriage(ctx);

  await app.listen({ port: config.port, host: '0.0.0.0' });
  app.log.info(
    { db: db.kind, aiProviders: llm.configured(), demoMode: config.demoMode },
    llm.configured().length ? 'AI enabled' : 'No LLM API key set: running with rules + template fallbacks',
  );

  const shutdown = async () => {
    hub.close();
    await app.close();
    await db.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
