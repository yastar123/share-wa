import { config } from "dotenv";
import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { once } from "node:events";
import pg from "pg";

const repoRoot = path.resolve(import.meta.dirname, "../../../..");
const envPath = path.join(repoRoot, ".env");
config({ path: envPath });

function requireEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} must be configured in .env or the process environment.`);
  }
  return value;
}

const databaseUrl = requireEnvironment("DATABASE_URL");
let sessionSecret = requireEnvironment("SESSION_SECRET");
const adminEmail = requireEnvironment("SHAREWA_ADMIN_EMAIL").toLowerCase();
const adminPassword = requireEnvironment("SHAREWA_ADMIN_PASSWORD");

if (sessionSecret.startsWith("$(")) {
  if (sessionSecret !== "$(openssl rand -hex 32)") {
    throw new Error("SESSION_SECRET contains an unsupported shell expression.");
  }
  sessionSecret = randomBytes(32).toString("hex");
  const envFile = await readFile(envPath, "utf8");
  const updatedEnvFile = /^(\s*SESSION_SECRET\s*=).*$/m.test(envFile)
    ? envFile.replace(/^(\s*SESSION_SECRET\s*=).*$/m, `$1${sessionSecret}`)
    : `${envFile.trimEnd()}\nSESSION_SECRET=${sessionSecret}\n`;
  await writeFile(envPath, updatedEnvFile, "utf8");
  process.env.SESSION_SECRET = sessionSecret;
  console.log("Generated and saved a persistent SESSION_SECRET in .env.");
}
if (adminPassword.length < 12 || adminPassword.length > 128) {
  throw new Error("SHAREWA_ADMIN_PASSWORD must contain 12–128 characters.");
}
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) {
  throw new Error("SHAREWA_ADMIN_EMAIL must be a valid email address.");
}

async function ensureTargetDatabaseExists(): Promise<void> {
  const targetUrl = new URL(databaseUrl);
  const databaseName = decodeURIComponent(targetUrl.pathname.slice(1));
  if (!databaseName || Buffer.byteLength(databaseName, "utf8") > 63) {
    throw new Error("DATABASE_URL must contain a valid PostgreSQL database name.");
  }

  targetUrl.pathname = "/postgres";
  const maintenancePool = new pg.Pool({
    connectionString: targetUrl.toString(),
    connectionTimeoutMillis: 10_000,
  });

  try {
    const result = await maintenancePool.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [databaseName],
    );
    if (result.rowCount) return;

    const quotedName = `"${databaseName.replaceAll('"', '""')}"`;
    try {
      await maintenancePool.query(`CREATE DATABASE ${quotedName}`);
      console.log("Created the database configured by DATABASE_URL.");
    } catch (error) {
      if (
        !error ||
        typeof error !== "object" ||
        !("code" in error) ||
        error.code !== "42P04"
      ) {
        throw error;
      }
    }
  } finally {
    await maintenancePool.end();
  }
}

await ensureTargetDatabaseExists();

const packageManager = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const migration = spawnSync(
  packageManager,
  ["--filter", "@workspace/db", "run", "push"],
  {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "inherit",
    shell: process.platform === "win32",
  },
);

if (migration.error) throw migration.error;
if (migration.status !== 0) {
  throw new Error(`Database schema push failed with exit code ${migration.status ?? "unknown"}.`);
}

const [{ ensureInitialAdmin }, { default: app }, { pool }] = await Promise.all([
  import("../lib/auth"),
  import("../app"),
  import("@workspace/db"),
]);

if (!pool) {
  throw new Error("The database connection was not initialized; refusing to verify against the in-memory fallback.");
}

await ensureInitialAdmin();

const server = app.listen(0, "127.0.0.1");
await once(server, "listening");

try {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not determine the local verification server address.");
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;
  const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ identifier: adminEmail, password: adminPassword }),
  });
  const loginBody: unknown = await loginResponse.json();

  if (
    !loginResponse.ok ||
    !loginBody ||
    typeof loginBody !== "object" ||
    !("isAdmin" in loginBody) ||
    loginBody.isAdmin !== true
  ) {
    throw new Error(`Admin login verification failed with HTTP ${loginResponse.status}.`);
  }

  const sessionCookie = loginResponse.headers.getSetCookie()
    .find((cookie) => cookie.startsWith("sharewa_session="))
    ?.split(";", 1)[0];
  if (!sessionCookie) {
    throw new Error("Admin login succeeded but the session cookie was not set.");
  }

  const adminResponse = await fetch(`${baseUrl}/api/admin/me`, {
    headers: { cookie: sessionCookie },
  });
  const adminBody: unknown = await adminResponse.json();
  if (
    !adminResponse.ok ||
    !adminBody ||
    typeof adminBody !== "object" ||
    !("isAdmin" in adminBody) ||
    adminBody.isAdmin !== true
  ) {
    throw new Error(`Admin session verification failed with HTTP ${adminResponse.status}.`);
  }

  console.log("Database schema push completed.");
  console.log("Admin login and authenticated admin access verified.");
} finally {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  await pool.end();
}
