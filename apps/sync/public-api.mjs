/**
 * The two facts anyone may read before a session exists.
 *
 * `/config` tells the browser which name this installation answers to; `/health` tells a
 * load balancer whether the store is up and which build answered. Both are branding or
 * operations, never tenant data (ADR-254 §3, ADR-089).
 */
export async function handlePublicRoutes({
  request,
  response,
  url,
  store,
  build,
  productName,
  productNameOverride,
}) {
  if (url.pathname === "/config" && request.method === "GET") {
    // `null` means “use the brand for the reader's language”, which only the client knows.
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ productName: productNameOverride ?? null }));
    return true;
  }

  if (url.pathname === "/health") {
    // A probe answers one bit, plus which build and which product answered it. Store
    // version and counts stay in metrics, not on the internet.
    const storage = await store.health();
    response.writeHead(storage.ok ? 200 : 503, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: storage.ok, ...build, name: productName }));
    return true;
  }

  return false;
}
