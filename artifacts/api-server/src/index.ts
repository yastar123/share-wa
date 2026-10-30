import app from "./app";
import { logger } from "./lib/logger";
import { ensureInitialAdmin } from "./lib/auth";
import { restoreWhatsAppSessions } from "./lib/whatsapp";

const port = Number(process.env["PORT"] || 3000);

async function startServer(): Promise<void> {
  try {
    await ensureInitialAdmin();
  } catch (error) {
    logger.warn({ err: error }, "Failed to ensure initial admin");
  }
  const server = app.listen(port, "0.0.0.0", () => {
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

