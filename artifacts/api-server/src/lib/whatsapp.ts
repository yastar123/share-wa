import {
  DisconnectReason,
  BufferJSON,
  initAuthCreds,
  makeWASocket,
  type AuthenticationCreds,
  type SignalDataSet,
  type SignalDataTypeMap,
  type SignalKeyStore,
  type WASocket,
} from "@whiskeysockets/baileys";
import { hkdfSync, randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import pino from "pino";
import { and, eq, inArray } from "drizzle-orm";
import { db, whatsappSessionsTable } from "@workspace/db";
import { logger } from "./logger";

type SessionRow = typeof whatsappSessionsTable.$inferSelect;
type SessionState = {
  creds: AuthenticationCreds;
  keys: Record<string, Record<string, unknown>>;
};

type ActiveConnection = {
  socket: WASocket;
  state: SessionState;
  pairingReady: Promise<void>;
  resolvePairingReady: () => void;
  manualDisconnect: boolean;
  reconnectScheduled: boolean;
};

export class WhatsAppConnectionError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 409,
  ) {
    super(message);
    this.name = "WhatsAppConnectionError";
  }
}

const activeConnections = new Map<string, ActiveConnection>();
const silentLogger = pino({ level: "silent" });
const sessionSecret = process.env.SESSION_SECRET || "sharewa-development-default-session-secret-key-32chars";
const encryptionKey = Buffer.from(
  hkdfSync(
    "sha256",
    Buffer.from(sessionSecret, "utf8"),
    Buffer.from("sharewa-session-storage-v1", "utf8"),
    Buffer.from("baileys-auth-state", "utf8"),
    32,
  ),
);


function encodeJson(value: unknown): string {
  return JSON.stringify(value, BufferJSON.replacer);
}

function decodeJson<T>(value: string): T {
  return JSON.parse(value, BufferJSON.reviver) as T;
}

function encrypt(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey!, iv);
  const ciphertext = Buffer.concat([
    cipher.update(encodeJson(value), "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

function decrypt<T>(value: string | null | undefined): T | null {
  if (!value) return null;
  const [version, encodedIv, encodedTag, encodedCiphertext] = value.split(".");
  if (
    version !== "v1" ||
    !encodedIv ||
    !encodedTag ||
    !encodedCiphertext
  ) {
    throw new Error("Stored WhatsApp session data has an unsupported format.");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey!,
    Buffer.from(encodedIv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encodedCiphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
  return decodeJson<T>(plaintext);
}

async function readSession(ownerUserId: string): Promise<SessionRow | null> {
  const [row] = await db
    .select()
    .from(whatsappSessionsTable)
    .where(eq(whatsappSessionsTable.ownerUserId, ownerUserId))
    .limit(1);
  return row ?? null;
}

async function saveSession(
  ownerUserId: string,
  values: Partial<typeof whatsappSessionsTable.$inferInsert>,
): Promise<void> {
  const update = { ...values, updatedAt: new Date() };
  await db
    .insert(whatsappSessionsTable)
    .values({ ownerUserId, ...values })
    .onConflictDoUpdate({
      target: whatsappSessionsTable.ownerUserId,
      set: update,
    });
}

function makeSignalKeyStore(
  ownerUserId: string,
  initialKeys: Record<string, Record<string, unknown>>,
): SignalKeyStore {
  let keys = initialKeys;

  return {
    get: async <T extends keyof SignalDataTypeMap>(
      type: T,
      ids: string[],
    ): Promise<{ [id: string]: SignalDataTypeMap[T] }> => {
      const bucket = keys[type] ?? {};
      const result: { [id: string]: SignalDataTypeMap[T] } = {};
      for (const id of ids) {
        const value = bucket[id];
        if (value !== undefined && value !== null) {
          result[id] = value as SignalDataTypeMap[T];
        }
      }
      return result;
    },
    set: async (data: SignalDataSet): Promise<void> => {
      for (const [type, values] of Object.entries(data)) {
        if (!values) continue;
        const bucket = (keys[type] ??= {});
        for (const [id, value] of Object.entries(values)) {
          if (value === null) delete bucket[id];
          else bucket[id] = value;
        }
      }
      await saveSession(ownerUserId, {
        encryptedSignalKeys: encrypt(keys),
      });
    },
    clear: async (): Promise<void> => {
      keys = {};
      await saveSession(ownerUserId, {
        encryptedSignalKeys: encrypt(keys),
      });
    },
  };
}

function getStoredState(row: SessionRow | null): SessionState {
  const creds = decrypt<AuthenticationCreds>(row?.encryptedCredentials);
  const keys = decrypt<Record<string, Record<string, unknown>>>(
    row?.encryptedSignalKeys,
  );
  return {
    creds: creds ?? initAuthCreds(),
    keys: keys ?? {},
  };
}

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) {
    throw new WhatsAppConnectionError(
      "Masukkan nomor lengkap dengan kode negara.",
      400,
    );
  }
  return digits;
}

async function startConnection(
  ownerUserId: string,
  forcedState?: SessionState,
): Promise<ActiveConnection> {
  const current = activeConnections.get(ownerUserId);
  if (current && !current.manualDisconnect) return current;

  const row = await readSession(ownerUserId);
  const state = forcedState ?? getStoredState(row);
  await saveSession(ownerUserId, {
    encryptedCredentials: encrypt(state.creds),
    encryptedSignalKeys: encrypt(state.keys),
    status: state.creds.registered ? "reconnecting" : "awaiting_link",
    lastError: null,
  });

  let resolvePairingReady!: () => void;
  const pairingReady = new Promise<void>((resolve) => {
    resolvePairingReady = resolve;
  });

  const keys = makeSignalKeyStore(ownerUserId, state.keys);
  const socket = makeWASocket({
    auth: { creds: state.creds, keys },
    logger: silentLogger,
    markOnlineOnConnect: false,
    syncFullHistory: false,
  });
  const connection: ActiveConnection = {
    socket,
    state,
    pairingReady,
    resolvePairingReady,
    manualDisconnect: false,
    reconnectScheduled: false,
  };
  activeConnections.set(ownerUserId, connection);

  socket.ev.on("creds.update", (update) => {
    Object.assign(state.creds, update);
    void saveSession(ownerUserId, {
      encryptedCredentials: encrypt(state.creds),
    }).catch((error: unknown) => {
      logger.error({ err: error }, "Failed to persist encrypted WhatsApp credentials");
    });
  });

  socket.ev.on("connection.update", (update) => {
    if (update.qr || update.connection === "open") {
      connection.resolvePairingReady();
    }

    if (update.connection === "open") {
      const rawId = socket.user?.id ?? "";
      const linkedPhone = rawId.split("@")[0]?.split(":")[0] || null;
      void saveSession(ownerUserId, {
        status: "connected",
        linkedPhone,
        lastError: null,
      }).catch((error: unknown) => {
        logger.error({ err: error }, "Failed to update WhatsApp connection status");
      });
      return;
    }

    if (update.connection === "close") {
      const statusCode = (
        update.lastDisconnect?.error as
          | { output?: { statusCode?: number } }
          | undefined
      )?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;

      if (loggedOut) {
        if (activeConnections.get(ownerUserId) === connection) {
          activeConnections.delete(ownerUserId);
        }
        void saveSession(ownerUserId, {
          status: "disconnected",
          linkedPhone: null,
          encryptedCredentials: null,
          encryptedSignalKeys: null,
          pairingCode: null,
          pairingExpiresAt: null,
          lastError: null,
        });
        return;
      }

      if (
        !connection.manualDisconnect &&
        !connection.reconnectScheduled &&
        activeConnections.get(ownerUserId) === connection
      ) {
        connection.reconnectScheduled = true;
        void saveSession(ownerUserId, {
          status: "reconnecting",
          lastError: "Koneksi terputus; mencoba menyambung kembali.",
        });
        setTimeout(() => {
          if (activeConnections.get(ownerUserId) === connection) {
            activeConnections.delete(ownerUserId);
            void startConnection(ownerUserId).catch((error: unknown) => {
              logger.warn({ err: error }, "WhatsApp reconnect attempt failed");
            });
          }
        }, 2500);
      }
    }
  });

  return connection;
}

export async function getWhatsAppStatus(ownerUserId: string): Promise<{
  status: "disconnected" | "awaiting_link" | "connected" | "reconnecting" | "error";
  linkedPhone: string | null;
  updatedAt: Date | null;
  message: string | null;
}> {
  let row = await readSession(ownerUserId);
  if (
    row?.encryptedCredentials &&
    row.status === "connected" &&
    !activeConnections.has(ownerUserId)
  ) {
    void startConnection(ownerUserId).catch((error: unknown) => {
      logger.warn({ err: error }, "Failed to restore WhatsApp session");
    });
    row = { ...row, status: "reconnecting" };
  }

  const live = activeConnections.get(ownerUserId);
  const status = live
    ? live.state.creds.registered
      ? row?.status === "connected"
        ? "connected"
        : "reconnecting"
      : "awaiting_link"
    : row?.status ?? "disconnected";

  return {
    status,
    linkedPhone: row?.linkedPhone ?? null,
    updatedAt: row?.updatedAt ?? null,
    message: row?.lastError ?? null,
  };
}

export async function requestWhatsAppPairingCode(
  ownerUserId: string,
  rawPhone: string,
): Promise<{ pairingCode: string; expiresInSeconds: number }> {
  const phone = normalizePhone(rawPhone);
  const row = await readSession(ownerUserId);
  if (row?.encryptedCredentials) {
    const storedCreds = decrypt<AuthenticationCreds>(row.encryptedCredentials);
    if (storedCreds?.registered) {
      throw new WhatsAppConnectionError(
        "Nomor ini sudah pernah ditautkan. Putuskan koneksi lalu tautkan ulang jika ingin memakai nomor lain.",
      );
    }
  }

  const connection = await startConnection(ownerUserId);
  await Promise.race([
    connection.pairingReady,
    new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new WhatsAppConnectionError(
              "Koneksi belum siap. Coba minta kode lagi sebentar.",
              503,
            ),
          ),
        20_000,
      ),
    ),
  ]);

  try {
    const pairingCode = await connection.socket.requestPairingCode(phone);
    await saveSession(ownerUserId, {
      status: "awaiting_link",
      pairingCode: null,
      pairingExpiresAt: new Date(Date.now() + 60_000),
      lastError: null,
    });
    return { pairingCode, expiresInSeconds: 60 };
  } catch (error) {
    throw new WhatsAppConnectionError(
      error instanceof Error ? error.message : "Kode pairing tidak dapat dibuat.",
      502,
    );
  }
}

export async function disconnectWhatsApp(ownerUserId: string): Promise<void> {
  const connection = activeConnections.get(ownerUserId);
  if (connection) {
    connection.manualDisconnect = true;
    activeConnections.delete(ownerUserId);
    try {
      await connection.socket.logout();
    } catch {
      // Session state is cleared below even if WhatsApp already closed the socket.
    }
  }
  await saveSession(ownerUserId, {
    status: "disconnected",
    linkedPhone: null,
    encryptedCredentials: null,
    encryptedSignalKeys: null,
    pairingCode: null,
    pairingExpiresAt: null,
    lastError: null,
  });
}

export async function sendOneManualWhatsAppMessage(
  ownerUserId: string,
  phone: string,
  text: string,
): Promise<string | null> {
  const connection = activeConnections.get(ownerUserId);
  if (!connection || !connection.state.creds.registered) {
    throw new WhatsAppConnectionError(
      "Hubungkan akun WhatsApp terlebih dahulu.",
    );
  }

  const digits = normalizePhone(phone);
  const candidates = await connection.socket.onWhatsApp(digits);
  const target = candidates?.find((candidate) => candidate.exists)?.jid;
  if (!target) {
    throw new WhatsAppConnectionError(
      "Nomor tujuan tidak ditemukan di WhatsApp.",
      422,
    );
  }

  const result = await connection.socket.sendMessage(target, { text });
  return result?.key?.id ?? null;
}

export async function restoreWhatsAppSessions(): Promise<void> {
  const rows = await db
    .select()
    .from(whatsappSessionsTable)
    .where(
      and(
        inArray(whatsappSessionsTable.status, ["connected", "reconnecting"]),
      ),
    );
  for (const row of rows) {
    if (!row.encryptedCredentials) continue;
    try {
      await startConnection(row.ownerUserId, getStoredState(row));
    } catch (error) {
      logger.warn({ err: error }, "Failed to restore a saved WhatsApp session");
    }
  }
}
