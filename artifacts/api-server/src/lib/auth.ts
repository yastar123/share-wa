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
import { logger } from "./logger";

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
  logger.info({ algorithm, storedHash }, "Verifying password attempt");
  if (algorithm !== "scrypt" || !encodedSalt || !encodedKey) {
      logger.warn("Invalid hash format");
      return false;
  }
  try {
    const salt = Buffer.from(encodedSalt, "base64url");
    const expected = Buffer.from(encodedKey, "base64url");
    
    const actual = scryptSync(password, salt, expected.length, {
      N: 32_768,
      r: 8,
      p: 1,
      maxmem: 64 * 1024 * 1024,
    });
    
    const matches = timingSafeEqual(actual, expected);
    if (!matches) {
        logger.warn({ actual: actual.toString("base64url"), expected: expected.toString("base64url") }, "Password hash mismatch");
    }
    return matches;
  } catch (e) {
    logger.error({ err: e }, "Password verification threw error");
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

async function seedAccount(tx: any, email: string, password: string, fullName: string, isAdmin: boolean) {
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
        fullName,
        username: email.split("@")[0] + "_" + randomBytes(3).toString("hex"),
        passwordHash: hashPassword(password),
        language: "id",
      })
      .returning();
    profile = created;
    logger.info({ email }, "Created seeded profile");
  } else {
    await tx
      .update(userProfilesTable)
      .set({
        passwordHash: hashPassword(password),
        accountStatus: "active",
        updatedAt: new Date(),
      })
      .where(eq(userProfilesTable.userId, profile.userId));
    logger.info({ email }, "Updated seeded profile password");
    await tx.delete(authSessionsTable).where(eq(authSessionsTable.userId, profile.userId));
  }

  if (isAdmin) {
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
        summary: "Peran admin diaktifkan melalui seeding.",
      });
      logger.info({ email }, "Admin role granted via seeding");
    }
  }
}

export async function ensureInitialAdmin(): Promise<void> {
  const adminEmail = normalizeEmail(process.env.SHAREWA_ADMIN_EMAIL ?? "");
  const adminPassword = process.env.SHAREWA_ADMIN_PASSWORD ?? "";

  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(190131041)`);

    // 1. Seed Main Admin from .env
    if (adminEmail && adminPassword.length >= 12) {
      await seedAccount(tx, adminEmail, adminPassword, "Administrator", true);
    }

    // 2. Seed Demo Accounts
    await seedAccount(tx, "admin.demo@sharewa.example", "DemoAdminPassword123", "Demo Admin", true);
    await seedAccount(tx, "user.demo@sharewa.example", "DemoUserPassword123", "Demo User", false);
  });
}

