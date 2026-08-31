import { buildApp } from './app.js';
import { config } from './config.js';

const app = await buildApp({ serveStatic: true });
try {
  await app.listen({ port: config.port, host: config.host });
  console.log(`Footprint API: http://${config.host}:${config.port}`);
  console.log(
    `ENS: mainnet RPC • Mobula: ${config.mobulaKey ? 'key configured' : 'not configured (demo works without a key)'}`,
  );
} catch {
  console.error(
    `Could not start Footprint on port ${config.port}. Check the port and .env configuration.`,
  );
  process.exit(1);
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}
