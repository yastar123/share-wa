import app from "./app";
import { logger } from "./lib/logger";
import { ensureInitialAdmin } from "./lib/auth";
import { restoreWhatsAppSessions } from "./lib/whatsapp";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function startServer(): Promise<void> {
  await ensureInitialAdmin();
  const server = app.listen(port, () => {
    logger.info({ port }, "Server listening");
    void restoreWhatsAppSessions().catch((error: unknown) => {
      logger.error({ err: error }, "Failed to restore WhatsApp sessions");
    });
  });
  server.on("error", (error: Error) => {
    logger.error({ err: error }, "Error listening on port");
    process.exit(1);
  });
}

void startServer().catch((error: unknown) => {
  logger.error({ err: error }, "Failed to initialize ShareWa");
  process.exit(1);
});
