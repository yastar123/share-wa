import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, lt, or } from "drizzle-orm";
import { Router, type IRouter, type Response } from "express";
import { z } from "zod/v4";
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
  passwordResetTokensTable,
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
import { isPasswordResetEmailConfigured, sendPasswordResetEmail } from "../lib/password-reset-email";

const router: IRouter = Router();
const attempts = new Map<string, { count: number; resetAt: number }>();
const attemptWindowMs = 15 * 60 * 1000;
const maxAttempts = 8;
const resetAttempts = new Map<string, { count: number; resetAt: number }>();
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

async function verifyTurnstile(
  token: string | undefined,
  remoteIp: string | undefined,
): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return process.env.NODE_ENV !== "production";
  if (!token) return false;
  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp) body.set("remoteip", remoteIp);
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) throw new Error(`Turnstile verification returned HTTP ${response.status}.`);
  const result = await response.json() as { success?: unknown };
  return result.success === true;
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
  const identifier = parsed.data.identifier.trim().toLowerCase();
  const attemptKey = `${req.ip ?? "unknown"}:${identifier}`;
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
    .where(or(
      eq(userProfilesTable.username, identifier),
      eq(userProfilesTable.email, normalizeEmail(identifier)),
    ))
    .limit(1);

  const validPassword = verifyPassword(
    parsed.data.password,
    profile?.passwordHash ?? dummyPasswordHash,
  );
  if (!profile || !validPassword || profile.accountStatus !== "active") {
    recordFailedAttempt(attemptKey);
    res.status(401).json({ error: "Nama pengguna atau kata sandi tidak sesuai." });
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
    res.status(400).json({ error: "Lengkapi nama, nama pengguna, dan kata sandi minimal 12 karakter." });
    return;
  }
  if (!parsed.data.termsAccepted) {
    res.status(400).json({ error: "Persetujuan Syarat & Ketentuan dan Kebijakan Privasi diperlukan." });
    return;
  }
  if (process.env.NODE_ENV === "production" && !process.env.TURNSTILE_SECRET_KEY) {
    res.status(503).json({ error: "Verifikasi keamanan belum dikonfigurasi oleh administrator." });
    return;
  }
  try {
    if (!(await verifyTurnstile(parsed.data.captchaToken, req.ip))) {
      res.status(400).json({ error: "Verifikasi bahwa Anda bukan robot belum berhasil." });
      return;
    }
  } catch (error) {
    req.log.error({ err: error }, "Cloudflare Turnstile verification failed");
    res.status(503).json({ error: "Verifikasi keamanan sedang tidak tersedia." });
    return;
  }
  const email = normalizeEmail(parsed.data.email);
  const username = parsed.data.username.trim().toLowerCase();
  const [existing] = await db
    .select({ userId: userProfilesTable.userId })
    .from(userProfilesTable)
    .where(or(
      eq(userProfilesTable.username, username),
      eq(userProfilesTable.email, email),
    ))
    .limit(1);
  if (existing) {
    res.status(409).json({ error: "Nama pengguna atau email sudah terdaftar." });
    return;
  }

  let referredByUserId: string | null = null;
  if (parsed.data.referralCode?.trim()) {
    const [referrer] = await db.select({ userId: userProfilesTable.userId })
      .from(userProfilesTable)
      .where(eq(userProfilesTable.referralCode, parsed.data.referralCode.trim().toUpperCase()))
      .limit(1);
    if (!referrer) {
      res.status(400).json({ error: "Kode referral tidak ditemukan." });
      return;
    }
    referredByUserId = referrer.userId;
  }
  try {
    const [profile] = await db
      .insert(userProfilesTable)
      .values({
        userId: `user_${randomBytes(16).toString("hex")}`,
        email,
        fullName: parsed.data.fullName.trim(),
        username,
        referralCode: randomBytes(5).toString("hex").toUpperCase(),
        referredByUserId,
        termsAcceptedAt: new Date(),
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
      res.status(409).json({ error: "Nama pengguna atau email sudah terdaftar." });
      return;
    }
    throw error;
  }
});

router.post("/auth/password-reset/request", async (req, res): Promise<void> => {
  const parsed = z.object({ email: z.string().email().max(254) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Masukkan alamat email yang valid." });
    return;
  }
  if (!isPasswordResetEmailConfigured()) {
    res.status(503).json({ error: "Pemulihan kata sandi belum dikonfigurasi oleh administrator." });
    return;
  }
  const attemptKey = req.ip ?? "unknown";
  const now = Date.now();
  const attempt = resetAttempts.get(attemptKey);
  if (attempt && attempt.resetAt > now && attempt.count >= 5) {
    res.status(429).json({ error: "Terlalu banyak permintaan. Coba lagi dalam satu jam." });
    return;
  }
  resetAttempts.set(attemptKey, {
    count: attempt && attempt.resetAt > now ? attempt.count + 1 : 1,
    resetAt: attempt && attempt.resetAt > now ? attempt.resetAt : now + 60 * 60 * 1000,
  });
  if (resetAttempts.size > 10_000) {
    for (const [key, value] of resetAttempts) {
      if (value.resetAt <= now) resetAttempts.delete(key);
    }
  }

  const email = normalizeEmail(parsed.data.email);
  await db.delete(passwordResetTokensTable)
    .where(lt(passwordResetTokensTable.expiresAt, new Date(now)));
  const [profile] = await db.select({
    userId: userProfilesTable.userId,
    email: userProfilesTable.email,
  }).from(userProfilesTable)
    .where(and(
      eq(userProfilesTable.email, email),
      eq(userProfilesTable.accountStatus, "active"),
    ))
    .limit(1);
  if (profile?.email) {
    const token = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    await db.delete(passwordResetTokensTable)
      .where(eq(passwordResetTokensTable.userId, profile.userId));
    await db.insert(passwordResetTokensTable).values({
      userId: profile.userId,
      tokenHash,
      expiresAt: new Date(now + 30 * 60 * 1000),
    });
    const appUrl = process.env.PUBLIC_APP_URL!.replace(/\/$/, "");
    const resetUrl = new URL("/reset-password", `${appUrl}/`);
    resetUrl.searchParams.set("token", token);
    try {
      await sendPasswordResetEmail(email, resetUrl.toString());
    } catch (error) {
      await db.delete(passwordResetTokensTable)
        .where(eq(passwordResetTokensTable.tokenHash, tokenHash));
      req.log.error({ err: error }, "Password reset email delivery failed");
    }
  }
  res.json({ message: "Jika email terdaftar, instruksi pemulihan akan dikirim." });
});

router.post("/auth/password-reset/confirm", async (req, res): Promise<void> => {
  const parsed = z.object({
    token: z.string().min(32).max(128),
    password: z.string().min(12).max(128),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Tautan atau kata sandi tidak valid." });
    return;
  }
  const tokenHash = createHash("sha256").update(parsed.data.token).digest("hex");
  const now = new Date();
  const result = await db.transaction(async (tx) => {
    const [reset] = await tx.select().from(passwordResetTokensTable)
      .where(and(
        eq(passwordResetTokensTable.tokenHash, tokenHash),
        gt(passwordResetTokensTable.expiresAt, now),
      ))
      .limit(1);
    if (!reset || reset.usedAt) return false;
    const [claimed] = await tx.update(passwordResetTokensTable)
      .set({ usedAt: now })
      .where(and(
        eq(passwordResetTokensTable.id, reset.id),
        eq(passwordResetTokensTable.tokenHash, tokenHash),
        gt(passwordResetTokensTable.expiresAt, now),
        isNull(passwordResetTokensTable.usedAt),
      ))
      .returning({ id: passwordResetTokensTable.id });
    if (!claimed) return false;
    await tx.update(userProfilesTable)
      .set({ passwordHash: hashPassword(parsed.data.password), updatedAt: now })
      .where(eq(userProfilesTable.userId, reset.userId));
    await tx.delete(authSessionsTable)
      .where(eq(authSessionsTable.userId, reset.userId));
    await tx.delete(passwordResetTokensTable)
      .where(eq(passwordResetTokensTable.userId, reset.userId));
    return true;
  });
  if (!result) {
    res.status(400).json({ error: "Tautan pemulihan tidak valid atau sudah kedaluwarsa." });
    return;
  }
  res.json({ message: "Kata sandi berhasil diubah. Silakan masuk kembali." });
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
