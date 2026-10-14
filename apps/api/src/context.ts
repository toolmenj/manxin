import type { Calendar } from '@manxin/engine';
import type { FastifyBaseLogger } from 'fastify';
import type { Clock } from './clock.ts';
import type { Config } from './config.ts';
import type { Db } from './db/client.ts';
import type { CourierProvider } from './services/courier.ts';
import type { Mailer } from './services/mailer.ts';
import type { Storage } from './services/storage.ts';
import type { WeatherProvider } from './services/weather.ts';

/** 一個請求或一次排程需要的所有依賴 */
export interface Ctx {
  cfg: Config;
  db: Db;
  clock: Clock;
  mailer: Mailer;
  weather: WeatherProvider;
  courier: CourierProvider;
  storage: Storage;
  calendar: Calendar;
  log: FastifyBaseLogger;
}

export const ms = (d: Date | null | undefined): number | null => (d ? d.getTime() : null);
