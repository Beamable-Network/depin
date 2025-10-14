import { createServer, IncomingMessage, ServerResponse } from 'http';

export class HealthServer {
  private server: ReturnType<typeof createServer> | null = null;
  private readonly port: number;

  constructor(port: number = 3000) {
    this.port = port;
  }

  start(): void {
    this.server = createServer((req: IncomingMessage, res: ServerResponse) => {
      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('OK');
        return;
      }

      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    });

    this.server.listen(this.port, '0.0.0.0');
  }

  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }
}
