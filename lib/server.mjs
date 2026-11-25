import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { ACTIVE, clearTickets, getEvents, getTicket, listTickets, removeTicket } from './db.mjs';

const page = readFileSync(new URL('./report.html', import.meta.url), 'utf8');

/**
 * Local report with destructive buttons, so: bound to 127.0.0.1 only, and every
 * write needs the page's own Origin plus a custom header (which forces a CORS
 * preflight this server never approves). Other websites cannot reach it.
 */
export function serve(db, profiles, port) {
  const origins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
  const prUrl = (t) => {
    const p = profiles.find((x) => x.id === t.profile);
    return p && t.pr_number ? `https://github.com/${p.repo.github}/pull/${t.pr_number}` : null;
  };

  const server = createServer(async (req, res) => {
    const send = (code, body, type = 'application/json') => {
      res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      res.end(type === 'application/json' ? JSON.stringify(body) : body);
    };
    const host = req.headers.host ?? '';
    if (!origins.has(`http://${host}`)) return send(421, { error: 'wrong host' });

    if (req.method === 'GET' && req.url === '/') {
      res.setHeader('content-security-policy', "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-ancestors 'none'");
      return send(200, page, 'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && req.url === '/api/tickets') {
      const tickets = listTickets(db).map((t) => ({ ...t, pr_url: prUrl(t), events: getEvents(db, t.key) }));
      return send(200, { tickets, active: ACTIVE, generatedAt: new Date().toISOString() });
    }
    if (req.method === 'POST') {
      if (!origins.has(req.headers.origin ?? '') || req.headers['x-tko'] !== '1') return send(403, { error: 'forbidden' });
      let body = '';
      for await (const chunk of req) body += chunk;
      const data = JSON.parse(body || '{}');
      if (req.url === '/api/remove') {
        const t = getTicket(db, data.key);
        if (!t) return send(404, { error: 'not found' });
        if (ACTIVE.includes(t.status) && !data.force) return send(409, { error: 'active', status: t.status });
        return send(200, { removed: removeTicket(db, data.key) });
      }
      if (req.url === '/api/clear' && (data.mode === 'closed' || (data.mode === 'all' && data.confirm === 'ALL'))) {
        return send(200, { removed: clearTickets(db, data.mode) });
      }
    }
    send(404, { error: 'not found' });
  });
  server.listen(port, '127.0.0.1', () => console.log(`Ticket Orchestrator report: http://127.0.0.1:${port}  (Ctrl+C to stop)`));
  return server;
}
