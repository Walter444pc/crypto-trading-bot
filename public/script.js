const socket = io({
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 1000
});
let candleChart, pieChart, liquidityChart;
const maxLogs = 100;
let logs = [];

document.addEventListener('DOMContentLoaded', () => {
  const logPanel = document.getElementById('log-panel');
  if (!logPanel) {
    console.error('log-panel element not found');
    return;
  }

  // Initialize price chart (line chart)
  candleChart = new Chart(document.getElementById('candle-chart'), {
    type: 'line',
    data: {
      datasets: [{
        label: 'Precio',
        data: [],
        borderColor: '#00ff00',
        backgroundColor: '#00ff00',
        fill: false
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { type: 'category' },
        y: { beginAtZero: false }
      }
    }
  });

  // Initialize pie chart
  pieChart = new Chart(document.getElementById('pie-chart'), {
    type: 'pie',
    data: {
      labels: [],
      datasets: [{
        data: [],
        backgroundColor: []
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false
    }
  });

  // Initialize liquidity chart
  liquidityChart = new Chart(document.getElementById('liquidity-chart'), {
    type: 'bar',
    data: {
      labels: [],
      datasets: [
        {
          label: 'Bid Volume',
          data: [],
          backgroundColor: '#00ff00',
          borderColor: '#00ff00',
          borderWidth: 1
        },
        {
          label: 'Ask Volume',
          data: [],
          backgroundColor: '#ff0000',
          borderColor: '#ff0000',
          borderWidth: 1
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          beginAtZero: true,
          title: { display: true, text: 'Volumen' }
        },
        x: {
          title: { display: true, text: 'Pares de Trading' }
        }
      },
      plugins: {
        legend: { display: true },
        title: { display: true, text: 'Liquidez por Par de Trading' }
      }
    }
  });

  // Handle command input
  document.getElementById('send-command').addEventListener('click', () => {
    const command = document.getElementById('command-input').value;
    socket.emit('command', command);
    document.getElementById('command-input').value = '';
  });

  // Clear logs
  document.getElementById('clear-logs').addEventListener('click', () => {
    socket.emit('command', 'clear logs');
  });
});

socket.on('connect', () => {
  console.log('Conectado al servidor WebSocket');
});

socket.on('disconnect', () => {
  console.log('Desconectado del servidor WebSocket');
});

socket.on('connect_error', (error) => {
  console.error('Error de conexión Socket.IO:', error.message);
});

socket.on('log', (data) => {
  try {
    console.log(`Log recibido: ${data.timestamp} [${data.level}]: ${data.message}`);
    logs.push(data);
    if (logs.length > maxLogs) logs.shift();
    const logPanel = document.getElementById('log-panel');
    if (!logPanel) {
      console.error('log-panel element not found during log update');
      return;
    }
    logPanel.innerHTML = logs.map(d => `<div class="log-entry log-${d.level.toLowerCase()}">[${d.timestamp}][${d.level}]: ${d.message}</div>`).join('');
    logPanel.scrollTop = logPanel.scrollHeight;
  } catch (error) {
    console.error('Error al procesar log:', error.message);
  }
});

socket.on('clearLogs', () => {
  logs = [];
  const logPanel = document.getElementById('log-panel');
  if (logPanel) logPanel.innerHTML = '';
  console.log('Logs limpiados en la UI');
});

socket.on('candles', (data) => {
  document.getElementById('candle-chart-title').textContent = `Gráfico de Precios (${data.symbol})`;
  candleChart.data.labels = data.data.map(d => d.x);
  candleChart.data.datasets[0].data = data.data.map(d => d.close);
  candleChart.update();
});

socket.on('indicators', (data) => {
  const tbody = document.querySelector('#metrics-table tbody');
  tbody.innerHTML = '';
  data.forEach(row => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${row[0]}</td><td>${row[1]}</td>`;
    tbody.appendChild(tr);
  });
});

socket.on('pairs', (data) => {
  const tbody = document.querySelector('#pairs-table tbody');
  tbody.innerHTML = '';
  data.forEach(row => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${row[0]}</td><td>${row[1]}</td>`;
    tbody.appendChild(tr);
  });
});

socket.on('pie', (data) => {
  pieChart.data.labels = data.map(d => d.label);
  pieChart.data.datasets[0].data = data.map(d => d.percent);
  pieChart.data.datasets[0].backgroundColor = data.map(d => d.color);
  pieChart.update();
});

socket.on('liquidity', (data) => {
  console.log(`Datos de liquidez recibidos: ${data.symbol}, Bid=${data.bid}, Ask=${data.ask}`);
  const index = liquidityChart.data.labels.indexOf(data.symbol);
  if (index === -1) {
    liquidityChart.data.labels.push(data.symbol);
    liquidityChart.data.datasets[0].data.push(data.bid);
    liquidityChart.data.datasets[1].data.push(data.ask);
  } else {
    liquidityChart.data.datasets[0].data[index] = data.bid;
    liquidityChart.data.datasets[1].data[index] = data.ask;
  }
  liquidityChart.update();
});

socket.on('balance', (balance) => {
  console.log('Balance actualizado:', balance);
});