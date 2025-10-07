const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static('public'));

const rooms = {}; // { roomId: [ {id, ws} ] }

let clientId = 0;

wss.on('connection', ws => {
  ws.id = clientId++;
  let currentRoom = null;

  ws.on('message', message => {
    const data = JSON.parse(message);

    if (data.type === 'join') {
      const roomId = data.room;
      currentRoom = roomId;
      if (!rooms[roomId]) rooms[roomId] = [];
      rooms[roomId].push({id: ws.id, ws});

      // Send existing participants to the new user
      const otherClients = rooms[roomId].filter(c => c.id !== ws.id).map(c => c.id);
      ws.send(JSON.stringify({ type: 'existing', clients: otherClients }));
      return;
    }

    // Forward signaling messages to target client
    if (data.target !== undefined && currentRoom && rooms[currentRoom]) {
      const targetClient = rooms[currentRoom].find(c => c.id === data.target);
      if (targetClient && targetClient.ws.readyState === WebSocket.OPEN) {
        targetClient.ws.send(JSON.stringify({ ...data, sender: ws.id }));
      }
    }
  });

  ws.on('close', () => {
    if (currentRoom && rooms[currentRoom]) {
      rooms[currentRoom] = rooms[currentRoom].filter(c => c.id !== ws.id);
      // Notify remaining clients
      rooms[currentRoom].forEach(c => {
        if (c.ws.readyState === WebSocket.OPEN) {
          c.ws.send(JSON.stringify({ type: 'leave', id: ws.id }));
        }
      });
      if (rooms[currentRoom].length === 0) delete rooms[currentRoom];
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
