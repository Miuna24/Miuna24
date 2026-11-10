const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { WebSocketServer, WebSocket } = require("ws");

const port = Number(process.env.PORT) || 3000;
const pagePath = path.join(__dirname, "index.html");
const feelings = new Set([
  "happy",
  "calm",
  "anger",
  "stressed",
  "sad",
  "great",
  "frustrated",
  "tired",
]);
const submissions = [];

const server = http.createServer((request, response) => {
  if (request.method !== "GET" || !["/", "/index.html"].includes(new URL(request.url, "http://localhost").pathname)) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  fs.readFile(pagePath, (error, content) => {
    if (error) {
      console.error("Could not read index.html:", error);
      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Unable to load the page.");
      return;
    }

    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(content);
  });
});

const webSocketServer = new WebSocketServer({ server, maxPayload: 4096 });

function broadcastSnapshot() {
  const message = JSON.stringify({ type: "snapshot", submissions });
  for (const client of webSocketServer.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

webSocketServer.on("connection", (socket) => {
  socket.send(JSON.stringify({ type: "snapshot", submissions }));

  socket.on("message", (rawMessage) => {
    let message;
    try {
      message = JSON.parse(rawMessage.toString());
    } catch {
      socket.send(JSON.stringify({ type: "error", message: "That response could not be read. Please try again." }));
      return;
    }

    if (
      !message
      || typeof message !== "object"
      || Array.isArray(message)
      || message.type !== "submit"
      || !feelings.has(message.feeling)
      || typeof message.reason !== "string"
      || !message.reason.trim()
      || message.reason.trim().length > 240
    ) {
      socket.send(JSON.stringify({ type: "error", message: "Choose a feeling and enter a reason of 1–240 characters." }));
      return;
    }

    submissions.push({
      feeling: message.feeling,
      reason: message.reason.trim(),
    });
    broadcastSnapshot();
  });
});

server.listen(port, () => {
  console.log(`Feeling word cloud is running at http://localhost:${port}`);
});

server.on("error", (error) => {
  console.error("The web server could not start:", error);
  process.exitCode = 1;
});
