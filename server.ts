import "dotenv/config";
import express from "express";
import path from "node:path";

import { createServer as createViteServer } from "vite";
import app from "./artifacts/api-server/src/app";
import { logger } from "./artifacts/api-server/src/lib/logger";
import { ensureInitialAdmin } from "./artifacts/api-server/src/lib/auth";
import { restoreWhatsAppSessions } from "./artifacts/api-server/src/lib/whatsapp";

const PORT = Number(process.env.PORT || 3000);
const isProd = process.env.NODE_ENV === "production";

async function main() {
  try {
    await ensureInitialAdmin();
  } catch (err) {
    logger.warn({ err }, "Initial admin setup skipped (database may not be ready)");
  }

  if (!isProd) {
    const vite = await createViteServer({
      configFile: path.resolve(import.meta.dirname, "artifacts/sharewa/vite.config.ts"),
      server: {
        middlewareMode: true,
        host: "0.0.0.0",
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const staticDir = path.resolve(import.meta.dirname, "artifacts/sharewa/dist");
    app.use(express.static(staticDir));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api")) return next();
      res.sendFile(path.join(staticDir, "index.html"));
    });
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    logger.info({ port: PORT }, `ShareWa running on http://0.0.0.0:${PORT}`);
    void restoreWhatsAppSessions().catch((err: unknown) => {
      logger.warn({ err }, "WhatsApp restore sessions skipped/failed");
    });
  });

  server.on("error", (err: Error) => {
    logger.error({ err }, `Server error on port ${PORT}`);
  });
}

main().catch((err) => {
  logger.error({ err }, "Failed to start server");
  process.exit(1);
});
