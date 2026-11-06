import { afterEach, describe, expect, it, vi } from "vitest";
import { login, call, stream, APIError } from "./api";
afterEach(() => vi.unstubAllGlobals());
describe("browser transport", () => {
  it("carries the CSRF token obtained by password and MFA login", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ csrf: "csrf-test" })))
      .mockResolvedValueOnce(new Response("[]"));
    vi.stubGlobal("fetch", fetch);
    await login("test-password", "123456");
    await call("ListAccounts");
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      Password: "test-password",
      OTP: "123456",
    });
    expect(fetch.mock.calls[1][1].headers["X-CSRF-Token"]).toBe("csrf-test");
  });
  it("preserves server errors rather than treating a failed send as success", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: "error.stale_draft" }), { status: 409 }),
        ),
    );
    await expect(call("SendRevision", 1, 2)).rejects.toMatchObject({
      status: 409,
      message: "error.stale_draft",
    });
  });
  it("decodes split UTF-8 and SSE frames without losing Korean text", async () => {
    const data = new TextEncoder().encode(
      'data: {"Kind":"text","Text":"안녕하세요"}\n\n: keepalive\n\ndata: {"Kind":"done"}\n\n',
    );
    const body = new ReadableStream({
      start(c) {
        for (let i = 0; i < data.length; i += 7) c.enqueue(data.slice(i, i + 7));
        c.close();
      },
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(body, { headers: { "Content-Type": "text/event-stream" } }),
        ),
    );
    const events: any[] = [];
    await stream("Ask", [1, "hello"], (e) => events.push(e), new AbortController().signal);
    expect(events).toEqual([{ Kind: "text", Text: "안녕하세요" }, { Kind: "done" }]);
  });
  it("refuses an authentication failure before opening a model stream", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("login required", { status: 401 })),
    );
    const event = vi.fn();
    await expect(
      stream("Ask", [1, "hello"], event, new AbortController().signal),
    ).rejects.toBeInstanceOf(APIError);
    expect(event).not.toHaveBeenCalled();
  });
});
