// The browser only talks to our API, never to graph8 (§16, §26).
export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public hint?: string) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      ...init,
      headers: { ...(init.json !== undefined ? { "Content-Type": "application/json" } : {}), ...init.headers },
      body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "OFFLINE", "Can't reach the Crash Test server", "Start it with: npm run dev");
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const e = data?.error ?? {};
    throw new ApiError(res.status, e.code ?? "ERROR", e.message ?? res.statusText, e.hint);
  }
  return data as T;
}

export const post = <T>(path: string, json: unknown = {}) => api<T>(path, { method: "POST", json });
export const patch = <T>(path: string, json: unknown) => api<T>(path, { method: "PATCH", json });
