'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const PORT = Math.max(1, Number(process.env.PORT) || 3000);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const DATA_FILE = path.resolve(process.env.DATA_FILE || path.join(ROOT, 'data', 'state.json'));
const MAX_BODY_SIZE = 256 * 1024;

if (!ADMIN_TOKEN) {
  console.error('Укажите переменную окружения ADMIN_TOKEN перед запуском.');
  process.exit(1);
}

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function cleanRow(row) {
  return {
    name: String(row?.name || '').slice(0, 60),
    buy: Math.max(0, Number(row?.buy) || 0),
    payout: Math.max(0, Number(row?.payout) || 0),
    opened: Boolean(row?.opened)
  };
}

function cleanState(input) {
  const rows = Array.isArray(input?.rows) ? input.rows.slice(0, 200).map(cleanRow) : [];
  const rawSessionNumber = String(input?.sessionNumber || '#1').replace(/[^\p{L}\p{N}#_-]/gu, '').slice(0, 12);
  const allowedCurrencies = new Set(['₽', '$', '€', '₸', '₴', '£']);
  const currency = allowedCurrencies.has(input?.currency) ? input.currency : '₽';
  return {
    rows: rows.length ? rows : [cleanRow({})],
    currentIndex: Math.min(Math.max(0, Number(input?.currentIndex) || 0), Math.max(0, rows.length - 1)),
    sessionNumber: rawSessionNumber.startsWith('#') ? rawSessionNumber : `#${rawSessionNumber || '1'}`,
    currency,
    updatedAt: new Date().toISOString()
  };
}

function readState() {
  try {
    return cleanState(JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')));
  } catch (_) {
    return cleanState({ rows: [{}], currentIndex: 0 });
  }
}

let state = readState();

function sendJson(response, status, data) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  response.end(JSON.stringify(data));
}

function isAuthorized(request) {
  const authorization = request.headers.authorization || '';
  return authorization === `Bearer ${ADMIN_TOKEN}`;
}

function saveState(nextState) {
  const directory = path.dirname(DATA_FILE);
  const temporaryFile = `${DATA_FILE}.tmp`;
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(temporaryFile, JSON.stringify(nextState, null, 2), 'utf8');
  fs.renameSync(temporaryFile, DATA_FILE);
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', chunk => {
      body += chunk;
      if (Buffer.byteLength(body, 'utf8') > MAX_BODY_SIZE) {
        reject(new Error('Payload too large'));
        request.destroy();
      }
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

function serveFile(response, relativePath) {
  const resolved = path.resolve(ROOT, relativePath);
  if (!resolved.startsWith(`${ROOT}${path.sep}`) && resolved !== ROOT) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }

  fs.readFile(resolved, (error, content) => {
    if (error) {
      response.writeHead(error.code === 'ENOENT' ? 404 : 500);
      response.end(error.code === 'ENOENT' ? 'Not found' : 'Server error');
      return;
    }
    response.writeHead(200, {
      'Content-Type': mimeTypes[path.extname(resolved).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store, no-cache, must-revalidate'
    });
    response.end(content);
  });
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);

  if (url.pathname === '/api/state' && request.method === 'GET') {
    sendJson(response, 200, state);
    return;
  }

  if (url.pathname === '/api/state' && request.method === 'PUT') {
    if (!isAuthorized(request)) {
      sendJson(response, 401, { error: 'Unauthorized' });
      return;
    }
    try {
      const body = JSON.parse(await readBody(request));
      state = cleanState(body);
      saveState(state);
      sendJson(response, 200, state);
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
    return;
  }

  if ((url.pathname === '/' || url.pathname === '/admin') && request.method === 'GET') {
    serveFile(response, 'index.html');
    return;
  }

  const file = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  if (request.method === 'GET' && ['style.css', 'script.js'].includes(file)) {
    serveFile(response, file);
    return;
  }

  response.writeHead(404);
  response.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`OBS widget: http://localhost:${PORT}/`);
  console.log(`Admin panel: http://localhost:${PORT}/admin`);
});
