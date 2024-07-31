const fs = require('fs');
const net = require('net');
const varint = require('varint');
const config = require('./config.json');

const writeQueue = [];
function write() {
  const data = writeQueue.splice(0).join('\n');
  if (data.length) {
    console.log(data);
    fs.appendFileSync(config.logFile, data + '\n');
  }
  setTimeout(write, 0);
}
write();

const server = net.createServer((socket) => {
  socket.connected = true;
  setTimeout(() => { if (socket.connected) socket.end() }, 6000);

  state = 0;
  let leftover = Buffer.alloc(0);
  socket.on('data', (data) => {
    try {
      data = Buffer.concat([leftover, data]);
      let packetLength;
      try {
        packetLength = varint.decode(data);
      } catch (err) {
        leftover = Buffer.alloc(0);
        return;
      }
      if (data.length < packetLength + varint.decode.bytes) {
        leftover = data;
        return;
      }
      leftover = data.subarray(packetLength + varint.decode.bytes);
      data = data.subarray(varint.decode.bytes, packetLength + varint.decode.bytes);
      switch (state) {
        case 0: {
          // handshake
          state = data[data.length - 1];
          if (data[0] != 0 || state < 1 || state > 2) socket.end();
          break;
        }
        case 1: {
          // status request
          if (data[0] != 0) {
            socket.end();
            break;
          }
          writeQueue.push(`${new Date().getTime()} STATUS ${socket.remoteAddress}`);
          for (const webhook of config.webhooks) {
            fetch(webhook, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                content: `STATUS ${socket.remoteAddress}`
              })
            });
          }
          const response = fs.readFileSync('./status.json').toString();
          const responseData = Buffer.concat([
            Buffer.from([0x00]), // packet id
            Buffer.from(varint.encode(response.length)),
            Buffer.from(response, 'utf-8')
          ]);
          const responseLength = Buffer.from(varint.encode(responseData.length));
          socket.write(Buffer.concat([responseLength, responseData]));
          socket.end();
          break;
        }
        case 2: {
          // login start
          if (data[0] != 0) {
            socket.end();
            break;
          }
          writeQueue.push(`${new Date().getTime()} JOIN ${socket.remoteAddress}`);
          for (const webhook of config.webhooks) {
              fetch(webhook, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                content: `JOIN ${socket.remoteAddress}`
              })
            });
          }
          const response = fs.readFileSync('./disconnectMessage.json').toString();
          const responseData = Buffer.concat([
            Buffer.from([0x00]), // packet id
            Buffer.from([response.length]),
            Buffer.from(response, 'utf-8')
          ]);
          const responseLength = Buffer.alloc(1);
          responseLength.writeUInt8(responseData.length);
          socket.write(Buffer.concat([responseLength, responseData]));
          socket.end();
          break;
        }
      }

      socket.emit('data', Buffer.alloc(0))
    } catch (err) {
      socket.end();
    }
  });

  socket.on('end', () => { socket.connected = false })
}).listen(25565);
