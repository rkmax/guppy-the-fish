import { createReadStream } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import http from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)));
const distDir = join(rootDir, 'dist');
const port = Number(process.env.PORT || 5173);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon',
};

function sendNotFound(response) {
  response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end('Not found');
}

function sendMethodNotAllowed(response) {
  response.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end('Method not allowed');
}

async function resolveRequestPath(urlPathname) {
  const requestedPath = urlPathname === '/' ? '/index.html' : urlPathname;
  const normalizedPath = normalize(requestedPath).replace(/^(\.\.[/\\])+/, '');
  const absolutePath = join(distDir, normalizedPath);

  if (!absolutePath.startsWith(distDir)) {
    throw new Error('Path traversal rejected');
  }

  try {
    const fileStat = await stat(absolutePath);
    if (fileStat.isDirectory()) {
      return join(absolutePath, 'index.html');
    }
    return absolutePath;
  } catch {
    if (!extname(absolutePath)) {
      return join(distDir, 'index.html');
    }
    throw new Error('Not found');
  }
}

const server = http.createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    sendMethodNotAllowed(response);
    return;
  }

  try {
    const requestUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    const absolutePath = await resolveRequestPath(requestUrl.pathname);
    await access(absolutePath);

    const mimeType = MIME_TYPES[extname(absolutePath)] || 'application/octet-stream';
    response.writeHead(200, {
      'Content-Type': mimeType,
      'Cache-Control': 'no-store',
    });

    if (request.method === 'HEAD') {
      response.end();
      return;
    }

    createReadStream(absolutePath).pipe(response);
  } catch (error) {
    if (String(error.message).includes('Not found')) {
      sendNotFound(response);
      return;
    }

    response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Server error');
  }
});

server.listen(port, () => {
  console.log(`Serving dist at http://localhost:${port}`);
});
