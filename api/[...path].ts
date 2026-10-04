/* Vercel serverless entry for the data API.
 *
 * The app ships two ways. Run `npm run serve` and server/index.mts serves dist/ and handles
 * /api/* itself. Deploy to Vercel and only dist/ is served — nothing runs server-side, which is
 * why /api/v1/... returned the HTML shell rather than JSON. This function is the missing half:
 * Vercel turns every file under /api into a function, and this one catches the whole /api/*
 * subtree and hands it to the same handler the local server uses, so there is one implementation
 * and the two deployments cannot answer differently.
 *
 * The first request after a cold start loads every sheet, so it is slow; later requests on the
 * same instance reuse the dataset server/api.mts caches in module scope.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleApiRequest } from '../server/api.mts';

export const config = { maxDuration: 60 };

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const handled = await handleApiRequest(req, res);
  if (!handled) {
    res.statusCode = 404;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'Unknown API endpoint', catalogue: '/api/v1' }));
  }
}
