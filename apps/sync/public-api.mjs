/**
 * The two facts anyone may read before a session exists.
 *
 * `/config` tells the browser which name this installation answers to and which compliance
 * zone it runs in; `/health` tells a load balancer whether the store is up and which build
 * answered. Both are branding or operations, never tenant data (ADR-254 §3, ADR-089).
 */
export async function handlePublicRoutes({
  request,
  response,
  url,
  store,
  build,
  productName,
  productNameOverride,
  move,
  compliance,
  legal,
  stage,
}) {
  if (url.pathname === "/config" && request.method === "GET") {
    // `null` means “use the brand for the reader's language”, which only the client knows.
    // The planned move is optional and appears only when the operator set a whole pair.
    // `compliance` and `legal` are never optional: a client that gets no answer shows
    // nothing, so the safe `none` zone is what a missing argument means (ADR-255 §3,
    // ADR-256 §4). Both links are always present as a key, `null` meaning there is
    // nothing to link; `legal.documents` is empty when this installation has no zone.
    const body = {
      productName: productNameOverride ?? null,
      compliance: compliance ?? { zone: "none", policyUrl: null, personalDataConsentUrl: null },
      legal: legal ?? { documents: [] },
    };
    if (move && move.to && move.at) {
      body.move = { to: move.to, at: move.at };
    }
    // A stand says so; production does not carry the field at all (§5).
    if (stage === true) body.stage = true;
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(body));
    return true;
  }

  if (url.pathname === "/health") {
    // A probe answers one bit, plus which build and which product answered it. Store
    // version and counts stay in metrics, not on the internet.
    const storage = await store.health();
    response.writeHead(storage.ok ? 200 : 503, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        ok: storage.ok,
        ...build,
        name: productName,
        ...(stage === true ? { stage: true } : {}),
      }),
    );
    return true;
  }

  return false;
}
