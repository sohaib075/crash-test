import pino from "pino";
import { config } from "./config";

export const log = pino({
  level: config.logLevel,
  transport: process.env.NODE_ENV === "production" || process.env.VITEST ? undefined : { target: "pino-pretty", options: { colorize: true, ignore: "pid,hostname", translateTime: "HH:MM:ss" } },
});
