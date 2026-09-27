// The browser only talks to our API, never to graph8 (§16, §26). By default it calls
// the same origin: the web app proxies /api and /socket.io to the API server
// (next.config.ts), so a deployment exposes one URL. NEXT_PUBLIC_API_URL can point
// the browser straight at an API on another origin instead.
export const API = process.env.NEXT_PUBLIC_API_URL ?? "";
// Absolute same-origin URL: fetch() rejects relative URLs on a page opened as http://user:pass@host/.
const base = () => API || (typeof window !== "undefined" ? window.location.origin : "");

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public hint?: string) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${base()}${path}`, {
      ...init,
      headers: { ...(init.json !== undefined ? { "Content-Type": "application/json" } : {}), ...init.headers },
      body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "OFFLINE", "Can't reach the Crash Test server", "Start it with: npm run dev");
  }
  const text = await res.text();
  let data: { error?: { code?: string; message?: string; hint?: string } } | null = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // Not JSON: a proxy or platform error page (API restarting or timed out).
    if (res.status >= 500) throw new ApiError(res.status, "UPSTREAM", "The Crash Test server is restarting or timed out", "Try again in a moment.");
    if (res.ok) throw new ApiError(res.status, "BAD_RESPONSE", "The server sent an unexpected response");
  }
  if (!res.ok) {
    const e = data?.error ?? {};
    throw new ApiError(res.status, e.code ?? "ERROR", e.message ?? res.statusText, e.hint);
  }
  return data as T;
}

export const post = <T>(path: string, json: unknown = {}) => api<T>(path, { method: "POST", json });
export const patch = <T>(path: string, json: unknown) => api<T>(path, { method: "PATCH", json });
