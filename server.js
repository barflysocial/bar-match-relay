const http = require("http");
const express = require("express");
const WebSocket = require("ws");

const app = express();
app.get("/", (req, res) => res.send("WS relay running"));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// roomKey -> { hosts:Set(ws), guests:Set(ws) }
const rooms = new Map();

function roomKey(barId, session) {
  return `${barId}::${session}`;
}

function getRoom(key) {
  if (!rooms.has(key)) rooms.set(key, { hosts: new Set(), guests: new Set() });
  return rooms.get(key);
}

function safeSend(ws, obj) {
  try { ws.send(JSON.stringify(obj)); } catch {}
}

wss.on("connection", (ws) => {
  ws.meta = { key: null, role: null };

  ws.on("message", (buf) => {
    let msg;
    try { msg = JSON.parse(buf.toString()); } catch { return; }

    // Identify client + room
    if (msg.type === "join") {
      const { role, barId, session } = msg;
      if (!role || !barId || !session) return;

      const key = roomKey(barId, session);
      ws.meta = { key, role };
      const room = getRoom(key);

      if (role === "host") room.hosts.add(ws);
      else room.guests.add(ws);

      safeSend(ws, { type: "joined", key });

      // tell hosts counts
      for (const host of room.hosts) {
        safeSend(host, { type: "room_stats", barId, session, hosts: room.hosts.size, guests: room.guests.size });
      }
      return;
    }

    if (!ws.meta.key) return;
    const room = rooms.get(ws.meta.key);
    if (!room) return;

    // Guest submits payload -> forward to hosts
    if (msg.type === "submit_payload") {
      for (const host of room.hosts) safeSend(host, { type: "payload_received", payload: msg.payload });
      safeSend(ws, { type: "submit_ack" });
      return;
    }
  });

  ws.on("close", () => {
    const key = ws.meta?.key;
    if (!key) return;
    const room = rooms.get(key);
    if (!room) return;

    room.hosts.delete(ws);
    room.guests.delete(ws);
    if (room.hosts.size === 0 && room.guests.size === 0) rooms.delete(key);
  });
});

// IMPORTANT: Render provides PORT via env var
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log("Listening on", PORT));

