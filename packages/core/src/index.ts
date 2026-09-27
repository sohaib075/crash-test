import { configureAi } from "@crash/ai";
import { config } from "./config";
import { call } from "./graph8/client";

// AI runs on graph8 copilot with the same key; no other provider (§22).
configureAi({
  chat: (message) => call("chat_with_copilot_copilot_chat_post", { body: { message, web_search: false, research: false, thinking: false } }, { retries: 1 }),
  enabled: config.aiEnabled && !!config.apiKey,
  timeoutMs: config.aiTimeoutMs,
});

export * from "./config";
export * from "./errors";
export * from "./log";
export * from "./publish";
export * from "./types";
export type { Backend } from "./backend";
export { graph8Backend } from "./graph8/backend";
export { call, callStats, GraphError } from "./graph8/client";
export * from "./engine/context";
export * from "./engine/fixes";
export * from "./engine/run";
export * from "./engine/gate";
export * from "./engine/queries";
export * from "./engine/ops";
export { REGISTRY } from "./tests/registry";
