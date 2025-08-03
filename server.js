const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const basicAuth = require('express-basic-auth');
const TradingBot = require('./Bot');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Basic authentication
app.use(basicAuth({
  users: { [process.env.ADMIN_USER]: process.env.ADMIN_PASSWORD },
  challenge: true,
  unauthorizedResponse: 'Acceso no autorizado'
}));

app.use(express.static(path.join(__dirname, 'public')));

const bot = new TradingBot(io);

io.on('connection', (socket) => {
  console.log('Cliente conectado');
  socket.emit('status', { running: bot.running, mode: bot.config.mode, selectionMode: bot.config.selectionMode, exchange: bot.config.exchange, strategy: bot.config.strategy });
  socket.emit('pairs', bot.selectedSymbols.map(s => [s, 'N/A']));
  socket.emit('balance', bot.balance);

  socket.on('command', async (text) => {
    console.log(`Comando recibido: ${text}`); // Debug log
    const [cmd, ...args] = text.trim().split(' ');
    switch (cmd) {
      case 'start':
        await bot.start();
        break;
      case 'stop':
        bot.stop();
        break;
      case 'liquidate':
        await bot.liquidate();
        break;
      case 'switch':
        if (args[0] === 'mode') bot.switchMode();
        else if (args[0] === 'selection') bot.setSelectionMode(args[1]);
        break;
      case 'set':
        if (args[0] === 'exchange') {
          bot.config.exchange = args[1];
          fs.writeFileSync('config.json', JSON.stringify(bot.config, null, 2));
          bot.logger.info(`Exchange establecido: ${args[1]}`);
        } else if (args[0] === 'strategy') {
          bot.setStrategy(args[1]);
        } else if (args[0] === 'symbol') {
          bot.setSymbol(args[1]);
        }
        break;
      case 'clear':
        if (args[0] === 'logs') socket.emit('clearLogs');
        break;
      default:
        bot.logger.info(`Comando desconocido: ${cmd}`);
    }
  });

  socket.on('disconnect', () => console.log('Cliente desconectado'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor iniciado en http://localhost:${PORT}`));