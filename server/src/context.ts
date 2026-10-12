import type { Config } from './config';
import type { Db } from './db';
import type { LlmGateway } from './ai/llm';
import type { Hub } from './realtime/hub';

export interface Logger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

/** Everything a service needs, passed explicitly. No globals, so tests can swap any piece. */
export interface Ctx {
  config: Config;
  db: Db;
  llm: LlmGateway;
  hub: Hub;
  log: Logger;
  /** Today as YYYY-MM-DD; honours APP_TODAY. */
  today(): string;
}
