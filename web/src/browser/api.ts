let csrf = "";
export class APIError extends Error {
  constructor(
    public status: number,
    message: string,
    public details: any = null,
  ) {
    super(message);
  }
}
async function response(r: Response) {
  if (!r.ok) {
    let text = await r.text();
    let details: any = null;
    try {
      details = JSON.parse(text);
      text = details.error || text;
    } catch {}
    throw new APIError(r.status, text, details);
  }
  return r;
}
export async function session() {
  const r = await response(await fetch("/api/v1/session"));
  const v = await r.json();
  csrf = v.csrf;
  return v;
}
export async function login(password: string, otp: string) {
  const r = await response(
    await fetch("/api/v1/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ Password: password, OTP: otp }),
    }),
  );
  csrf = (await r.json()).csrf;
}
export async function logout() {
  await response(
    await fetch("/api/v1/logout", { method: "POST", headers: { "X-CSRF-Token": csrf } }),
  );
  csrf = "";
}
export async function call<T = any>(method: string, ...params: unknown[]): Promise<T> {
  const r = await response(
    await fetch(`/api/v1/call/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: JSON.stringify(params),
    }),
  );
  return r.json();
}
export async function upload(id: number, revision: number, file: File) {
  const data = new FormData();
  data.set("file", file);
  const r = await response(
    await fetch(`/api/v1/upload/${id}?revision=${revision}`, {
      method: "POST",
      headers: { "X-CSRF-Token": csrf },
      body: data,
    }),
  );
  return r.json();
}
export async function stream(
  method: string,
  params: unknown[],
  event: (v: any) => void,
  signal: AbortSignal,
) {
  const r = await response(
    await fetch(`/api/v1/call/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: JSON.stringify(params),
      signal,
    }),
  );
  if (!r.headers.get("Content-Type")?.includes("text/event-stream"))
    throw new Error("AI stream unavailable");
  const reader = r.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let end: number;
    while ((end = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      for (const line of frame.split("\n"))
        if (line.startsWith("data: ")) event(JSON.parse(line.slice(6)));
    }
  }
}

export async function editorLease(id: number, key: string, close = false) {
  await response(
    await fetch(`/api/v1/editor/${id}`, {
      method: close ? "DELETE" : "POST",
      headers: { "X-CSRF-Token": csrf, "X-Editor-ID": key },
      keepalive: close,
    }),
  );
}

export async function allowImages(id: number) {
  await response(
    await fetch(`/api/v1/images/${id}`, { method: "POST", headers: { "X-CSRF-Token": csrf } }),
  );
}
