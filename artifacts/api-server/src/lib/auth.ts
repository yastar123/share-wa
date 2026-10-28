import {
  createHash,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { eq, lt, sql } from "drizzle-orm";
import {
  activityTable,
  adminUsersTable,
  authSessionsTable,
  db,
  userProfilesTable,
} from "@workspace/db";

export const AUTH_COOKIE_NAME = "sharewa_session";
export const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 32, {
    N: 32_768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const [algorithm, encodedSalt, encodedKey] = storedHash.split("$");
  if (algorithm !== "scrypt" || !encodedSalt || !encodedKey) return false;
  try {
    const salt = Buffer.from(encodedSalt, "base64url");
    const expected = Buffer.from(encodedKey, "base64url");
    if (salt.length !== 16 || expected.length !== 32) return false;
    const actual = scryptSync(password, salt, expected.length, {
      N: 32_768,
      r: 8,
      p: 1,
      maxmem: 64 * 1024 * 1024,
    });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createUserSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_MS);
  await db.delete(authSessionsTable).where(lt(authSessionsTable.expiresAt, new Date()));
  await db.insert(authSessionsTable).values({
    userId,
    tokenHash: hashSessionToken(token),
    expiresAt,
  });
  return token;
}

export async function ensureInitialAdmin(): Promise<void> {
  const email = normalizeEmail(process.env.SHAREWA_ADMIN_EMAIL ?? "");
  const password = process.env.SHAREWA_ADMIN_PASSWORD ?? "";
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("SHAREWA_ADMIN_EMAIL must be a valid email address.");
  }
  if (password.length < 12 || Buffer.byteLength(password, "utf8") > 256) {
    throw new Error("SHAREWA_ADMIN_PASSWORD must be 12–128 characters.");
  }

  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(190131041)`);
    let [profile] = await tx
      .select()
      .from(userProfilesTable)
      .where(eq(userProfilesTable.email, email))
      .limit(1);

    if (!profile) {
      const [created] = await tx
        .insert(userProfilesTable)
        .values({
          userId: `user_${randomUUID()}`,
          email,
          fullName: "Administrator",
          username: `admin_${randomBytes(5).toString("hex")}`,
          passwordHash: hashPassword(password),
          language: "id",
        })
        .returning();
      profile = created;
    } else {
      const passwordMatches =
        profile.passwordHash && verifyPassword(password, profile.passwordHash);
      if (!passwordMatches || profile.accountStatus !== "active") {
        await tx
          .update(userProfilesTable)
          .set({
            passwordHash: passwordMatches
              ? profile.passwordHash
              : hashPassword(password),
            accountStatus: "active",
            updatedAt: new Date(),
          })
          .where(eq(userProfilesTable.userId, profile.userId));
        if (!passwordMatches) {
          await tx
            .delete(authSessionsTable)
            .where(eq(authSessionsTable.userId, profile.userId));
        }
      }
    }

    const [existingRole] = await tx
      .select({ userId: adminUsersTable.userId })
      .from(adminUsersTable)
      .where(eq(adminUsersTable.userId, profile.userId))
      .limit(1);
    if (!existingRole) {
      await tx.insert(adminUsersTable).values({ userId: profile.userId });
      await tx.insert(activityTable).values({
        ownerUserId: profile.userId,
        kind: "admin_role_granted",
        summary: "Peran admin awal diaktifkan.",
      });
    }
  });
}
