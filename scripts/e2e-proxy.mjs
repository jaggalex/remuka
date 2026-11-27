#!/usr/bin/env node
/**
 * A controllable proxy in front of the sync service, for the offline scenario (ADR-090).
 *
 * Chromium's offline emulation does not affect connections to localhost, so a local e2e
 * run cannot lose its WebSocket by `setOffline`. The proxy can drop and refuse WebSockets
 * for one room while other tests keep using HTTP and their own room connections. It exists
 * only in the test harness.
 */
import { createServer, request as httpRequest } from "node:http";
import net from "node:net";

const PORT = Number(process.env.E2E_PROXY_PORT ?? 1237);
const TARGET = new URL(process.env.E2E_PROXY_TARGET ?? "http://localhost:1235");
const targetPort = Number(TARGET.port);
const targetHost = TARGET.hostname;

const pausedRooms = new Set();
const live = new Map();

function control(request, response, url) {
  const boardId = url.searchParams.get("board");
  const pause = url.pathname === "/__control/pause";
  const resume = url.pathname === "/__control/resume";
  if (request.method !== "POST" || !boardId || (!pause && !resume)) {
    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "unknown control" }));
    return;
  }
  const room = `/${encodeURIComponent(boardId)}`;
  if (pause) {
    pausedRooms.add(room);
    for (const [socket, path] of live) {
      if (path === room) socket.destroy();
    }
  } else {
    pausedRooms.delete(room);
  }
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ paused: pause }));
  console.log(`[e2e-proxy] ${pause ? "paused" : "resumed"} ${room}`);
}

const server = createServer((request, response) => {
  if (request.url?.startsWith("/__control/")) {
    return control(request, response, new URL(request.url, TARGET));
  }
  const upstream = httpRequest(
    {
      host: targetHost,
      port: targetPort,
      method: request.method,
      path: request.url,
      headers: request.headers,
    },
    (answer) => {
      response.writeHead(answer.statusCode ?? 502, answer.headers);
      answer.pipe(response);
    },
  );
  upstream.on("error", () => response.destroy());
  request.pipe(upstream);
});

server.on("upgrade", (request, socket, head) => {
  const room = new URL(request.url, TARGET).pathname;
  if (pausedRooms.has(room)) {
    socket.destroy();
    return;
  }
  const upstream = net.connect(targetPort, targetHost, () => {
    const headers = Object.entries(request.headers)
      .map(([name, value]) => `${name}: ${value}`)
      .join("\r\n");
    upstream.write(`${request.method} ${request.url} HTTP/1.1\r\n${headers}\r\n\r\n`);
    if (head.length) upstream.write(head);
    socket.pipe(upstream);
    upstream.pipe(socket);
  });
  live.set(socket, room);
  live.set(upstream, room);
  const clean = () => {
    live.delete(socket);
    live.delete(upstream);
  };
  socket.on("close", clean);
  socket.on("error", clean);
  upstream.on("close", clean);
  upstream.on("error", clean);
});

server.listen(PORT, () => {
  console.log(`[e2e-proxy] listening on :${PORT} → ${targetHost}:${targetPort}`);
});
