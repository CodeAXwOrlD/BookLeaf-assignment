import { createLlm } from '../ai/llm';
import { loadConfig, todayISO } from '../config';
import { createDb } from '../db';
import { Hub } from '../realtime/hub';
import { seedDatabase } from './seed';

/** npm run seed -- --reset   (drops all data and reseeds) */
const config = loadConfig();
const db = await createDb(config);
if (process.argv.includes('--reset')) {
  await db.exec(`TRUNCATE ai_usage, ai_drafts, ticket_events, ticket_messages, tickets, books, users, authors RESTART IDENTITY CASCADE`);
}
const [{ n }] = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM authors');
if (n > 0) {
  console.log('Database already has data. Use --reset to wipe and reseed.');
} else {
  const hub = new Hub();
  await seedDatabase({ config, db, hub, llm: createLlm(config.llm), log: console as any, today: () => todayISO(config) });
  hub.close();
  console.log('Seeded 10 authors, 18 books, 2 admins and demo tickets.');
}
await db.close();
