import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist');
const port = Number(process.env.PORT || 8770);
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.ttf':'font/ttf','.svg':'image/svg+xml'};
http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const file = path.resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    const body = await readFile(file);
    res.writeHead(200, {'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache'}).end(body);
  } catch { res.writeHead(404).end('Not found'); }
}).listen(port, '127.0.0.1', () => console.log(`Local: http://127.0.0.1:${port}`));
