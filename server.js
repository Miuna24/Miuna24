const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { WebSocketServer, WebSocket } = require("ws");

const port = Number(process.env.PORT) || 3000;
const publicDirectory = __dirname;
const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, `http://${request.headers.host || "localhost"}`).pathname;
  if (request.method !== "GET" || (pathname !== "/" && pathname !== "/index.html")) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  fs.readFile(path.join(publicDirectory, "index.html"), (error, content) => {
    if (error) {
      console.error("Could not read index.html:", error);
      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Unable to load the artwork.");
      return;
    }
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    });
    response.end(content);
  });
});

const websocketServer = new WebSocketServer({ noServer: true, maxPayload: 512 });
const clients = new Map();
const validGestures = new Set(["tap", "swipe", "drift", "motion", "shake"]);

function broadcast(payload) {
  const message = JSON.stringify(payload);
  for (const client of websocketServer.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(message);
  }
}

function broadcastCount() {
  broadcast({ type: "state", count: websocketServer.clients.size });
}

server.on("upgrade", (request, socket, head) => {
  const pathname = new URL(request.url, `http://${request.headers.host || "localhost"}`).pathname;
  if (pathname !== "/ws") {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
    return;
  }
  websocketServer.handleUpgrade(request, socket, head, (websocket) => {
    websocketServer.emit("connection", websocket, request);
  });
});

websocketServer.on("connection", (websocket) => {
  const clientId = crypto.randomUUID();
  clients.set(websocket, { clientId, windowStartedAt: Date.now(), messagesInWindow: 0 });
  websocket.send(JSON.stringify({ type: "welcome", clientId }));
  broadcastCount();

  websocket.on("message", (rawMessage) => {
    const client = clients.get(websocket);
    if (!client) return;
    const now = Date.now();
    if (now - client.windowStartedAt >= 1000) {
      client.windowStartedAt = now;
      client.messagesInWindow = 0;
    }
    client.messagesInWindow++;
    if (client.messagesInWindow > 35) return;

    let data;
    try {
      data = JSON.parse(rawMessage.toString());
    } catch (error) {
      console.warn("Ignored malformed WebSocket message.");
      return;
    }
    if (
      !data ||
      data.type !== "pulse" ||
      !Number.isFinite(data.x) ||
      !Number.isFinite(data.y) ||
      !Number.isFinite(data.strength) ||
      !Number.isFinite(data.hue) ||
      !validGestures.has(data.gesture)
    ) return;

    broadcast({
      type: "pulse",
      clientId: client.clientId,
      x: Math.max(0, Math.min(1, data.x)),
      y: Math.max(0, Math.min(1, data.y)),
      strength: Math.max(0.18, Math.min(1, data.strength)),
      hue: ((data.hue % 360) + 360) % 360,
      gesture: data.gesture
    });
  });

  websocket.on("close", () => {
    clients.delete(websocket);
    broadcastCount();
  });

  websocket.on("error", (error) => {
    console.error("WebSocket client error:", error.message);
  });
});

server.on("error", (error) => {
  console.error("HTTP server error:", error);
  process.exitCode = 1;
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Common Ground is running at http://localhost:${port}`);
  console.log("For other devices on your Wi-Fi, use this computer's local IP address.");
});
