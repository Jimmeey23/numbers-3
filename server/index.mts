import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { handleApiRequest } from './api.mts';

const root = join(process.cwd(), 'dist');
const port = Number(process.env.PORT ?? 4173);
const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
};

const server = createServer(async (req, res) => {
  if (await handleApiRequest(req, res)) return;
  const path = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`).pathname;
  const candidate = normalize(join(root, path === '/' ? 'index.html' : path));
  const file = candidate.startsWith(root) && existsSync(candidate) && statSync(candidate).isFile() ? candidate : join(root, 'index.html');
  if (!existsSync(file)) {
    res.statusCode = 503; res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end('Build not found. Run npm run build first.'); return;
  }
  res.statusCode = 200; res.setHeader('content-type', mime[extname(file)] ?? 'application/octet-stream');
  createReadStream(file).pipe(res);
});
server.listen(port, '0.0.0.0', () => console.log(`Floor app + API listening on http://0.0.0.0:${port}`));
