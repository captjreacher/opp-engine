// Run with Deno, not Vitest. No env permission, credentials, database or provider
// access: the only permitted runtime network destination is the loopback server.
// Remote imports are downloaded separately by `deno check` before this test.
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("worker startup registers once and serves real local HTTP requests", async () => {
  const originalServe = Deno.serve;
  let server: Deno.HttpServer<Deno.NetAddr> | undefined;
  let registrations = 0;
  Deno.serve = ((handler: Deno.ServeHandler<Deno.NetAddr>) => {
    registrations++;
    assert(registrations === 1, "Worker registered more than once");
    server = originalServe({ hostname: "127.0.0.1", port: 0, onListen() {} }, handler);
    return server;
  }) as typeof Deno.serve;

  try {
    // Import the entire unchanged dependency graph and actual worker, without
    // calling handler ourselves. Registration must happen during evaluation.
    await import("../supabase/functions/local-business-enrich/index.ts");
    assert(registrations === 1, "Worker did not register during module startup");
    assert(server, "Worker did not create an HTTP server");
    const url = `http://127.0.0.1:${server.addr.port}/`;

    const options = await fetch(url, { method: "OPTIONS", signal: AbortSignal.timeout(2_000) });
    assert(options.status === 200, `OPTIONS returned ${options.status}`);
    assert(await options.text() === "ok", "Preflight did not reach handler");
    assert(options.headers.get("access-control-allow-methods") === "POST, OPTIONS", "CORS changed");

    const get = await fetch(url, { signal: AbortSignal.timeout(2_000) });
    assert(get.status === 405, `GET returned ${get.status}`);
    const body = await get.json();
    assert(body.ok === false && body.status === "failed" && body.error === "method_not_allowed",
      "Request did not reach the worker's method validation");
    assert(registrations === 1, "Requests must not register additional listeners");
  } finally {
    Deno.serve = originalServe;
    await server?.shutdown();
  }
});
