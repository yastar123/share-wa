import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { Router, type IRouter, type Response } from "express";
import {
  GetCurrentUserResponse,
  RegisterUserBody,
  RegisterUserResponse,
  SignInBody,
  SignInResponse,
  SignOutResponse,
} from "@workspace/api-zod";
import {
  adminUsersTable,
  authSessionsTable,
  db,
  userProfilesTable,
} from "@workspace/db";
import {
  AUTH_COOKIE_NAME,
  SESSION_MAX_AGE_MS,
  createUserSession,
  hashPassword,
  normalizeEmail,
  verifyPassword,
} from "../lib/auth";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();
const attempts = new Map<string, { count: number; resetAt: number }>();
const attemptWindowMs = 15 * 60 * 1000;
const maxAttempts = 8;
const dummyPasswordHash =
  "scrypt$MDEyMzQ1Njc4OWFiY2RlZg$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

function tooManyAttempts(key: string): boolean {
  const now = Date.now();
  const current = attempts.get(key);
  if (!current || current.resetAt <= now) {
    attempts.set(key, { count: 0, resetAt: now + attemptWindowMs });
    return false;
  }
  return current.count >= maxAttempts;
}

function recordFailedAttempt(key: string): void {
  const now = Date.now();
  const current = attempts.get(key);
  if (!current || current.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + attemptWindowMs });
  } else {
    current.count += 1;
  }
  if (attempts.size > 10_000) {
    for (const [entryKey, value] of attempts) {
      if (value.resetAt <= now) attempts.delete(entryKey);
    }
  }
}

function setSessionCookie(res: Response, token: string): void {
  res.cookie(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_MS,
  });
}

async function getAuthUser(userId: string) {
  const [row] = await db
    .select({
      userId: userProfilesTable.userId,
      email: userProfilesTable.email,
      fullName: userProfilesTable.fullName,
      isAdmin: adminUsersTable.userId,
    })
    .from(userProfilesTable)
    .leftJoin(
      adminUsersTable,
      eq(adminUsersTable.userId, userProfilesTable.userId),
    )
    .where(eq(userProfilesTable.userId, userId))
    .limit(1);
  return row
    ? GetCurrentUserResponse.parse({ ...row, isAdmin: Boolean(row.isAdmin) })
    : null;
}

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = SignInBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Masukkan email dan kata sandi yang valid." });
    return;
  }
  const email = normalizeEmail(parsed.data.email);
  const attemptKey = `${req.ip ?? "unknown"}:${email}`;
  if (tooManyAttempts(attemptKey)) {
    res.status(429).json({ error: "Terlalu banyak percobaan. Coba lagi dalam 15 menit." });
    return;
  }

  const [profile] = await db
    .select({
      userId: userProfilesTable.userId,
      passwordHash: userProfilesTable.passwordHash,
      accountStatus: userProfilesTable.accountStatus,
    })
    .from(userProfilesTable)
    .where(eq(userProfilesTable.email, email))
    .limit(1);

  const validPassword = verifyPassword(
    parsed.data.password,
    profile?.passwordHash ?? dummyPasswordHash,
  );
  if (!profile || !validPassword || profile.accountStatus !== "active") {
    recordFailedAttempt(attemptKey);
    res.status(401).json({ error: "Email atau kata sandi tidak sesuai." });
    return;
  }

  attempts.delete(attemptKey);
  const [user] = await db
    .select({
      userId: userProfilesTable.userId,
      email: userProfilesTable.email,
      fullName: userProfilesTable.fullName,
      isAdmin: adminUsersTable.userId,
    })
    .from(userProfilesTable)
    .leftJoin(
      adminUsersTable,
      eq(adminUsersTable.userId, userProfilesTable.userId),
    )
    .where(eq(userProfilesTable.userId, profile.userId))
    .limit(1);
  if (!user) {
    res.status(401).json({ error: "Silakan masuk untuk melanjutkan." });
    return;
  }
  const token = await createUserSession(profile.userId);
  setSessionCookie(res, token);
  res.json(SignInResponse.parse({ ...user, isAdmin: Boolean(user.isAdmin) }));
});

router.post("/auth/register", async (req, res): Promise<void> => {
  const parsed = RegisterUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Lengkapi nama, email, dan kata sandi minimal 12 karakter." });
    return;
  }

  const email = normalizeEmail(parsed.data.email);
  const [existing] = await db
    .select({ userId: userProfilesTable.userId })
    .from(userProfilesTable)
    .where(eq(userProfilesTable.email, email))
    .limit(1);
  if (existing) {
    res.status(409).json({ error: "Email tersebut sudah terdaftar." });
    return;
  }

  const baseUsername =
    email
      .split("@")[0]
      ?.toLowerCase()
      .replace(/[^a-z0-9_.-]/g, "")
      .slice(0, 28) || "member";
  const username = `${baseUsername}_${randomBytes(3).toString("hex")}`;
  try {
    const [profile] = await db
      .insert(userProfilesTable)
      .values({
        userId: `user_${randomBytes(16).toString("hex")}`,
        email,
        fullName: parsed.data.fullName.trim(),
        username,
        passwordHash: hashPassword(parsed.data.password),
        language: "id",
      })
      .returning({
        userId: userProfilesTable.userId,
        email: userProfilesTable.email,
        fullName: userProfilesTable.fullName,
      });
    if (!profile) {
      res.status(500).json({ error: "Akun tidak dapat dibuat." });
      return;
    }

    const token = await createUserSession(profile.userId);
    setSessionCookie(res, token);
    res
      .status(201)
      .json(RegisterUserResponse.parse({ ...profile, isAdmin: false }));
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "23505"
    ) {
      res.status(409).json({ error: "Email tersebut sudah terdaftar." });
      return;
    }
    throw error;
  }
});

router.get("/auth/me", requireAuth, async (_req, res): Promise<void> => {
  const user = await getAuthUser(res.locals.userId as string);
  if (!user) {
    res.status(401).json({ error: "Silakan masuk untuk melanjutkan." });
    return;
  }
  res.json(user);
});

router.post("/auth/logout", requireAuth, async (_req, res): Promise<void> => {
  const sessionId = res.locals.sessionId as string;
  await db
    .delete(authSessionsTable)
    .where(eq(authSessionsTable.id, sessionId));
  res.clearCookie(AUTH_COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });
  res.json(SignOutResponse.parse({ signedOut: true }));
});

export default router;
