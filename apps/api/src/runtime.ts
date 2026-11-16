/** 依設定建立外部服務（API、worker、範例資料共用，避免三處各寫一份） */
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from './config.ts';
import { CountyTableCourier, type CourierProvider } from './services/courier.ts';
import { ConsoleMailer, OutboxMailer, SmtpTransport, type Mailer } from './services/mailer.ts';
import { DbStorage, LocalDiskStorage, type Storage } from './services/storage.ts';
import { CwaWeather, MockWeather, type WeatherProvider } from './services/weather.ts';

type Log = Pick<FastifyBaseLogger, 'info' | 'warn' | 'error'>;

export function makeMailer(cfg: Config, log: Log): Mailer {
  return cfg.mailer === 'smtp' ? new OutboxMailer(new SmtpTransport(cfg.smtp, cfg.mailFrom), log) : new ConsoleMailer(log, cfg.mailFrom);
}

export const makeStorage = (cfg: Config): Storage => (cfg.storage === 'db' ? new DbStorage() : new LocalDiskStorage(cfg.uploadDir));
export const makeWeather = (cfg: Config, log?: Log): WeatherProvider =>
  cfg.weatherProvider === 'cwa' ? new CwaWeather(cfg.cwaApiKey, log) : new MockWeather();
export const makeCourier = (): CourierProvider => new CountyTableCourier();
