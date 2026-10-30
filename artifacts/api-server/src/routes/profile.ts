import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { ChangePasswordBody } from "@workspace/api-zod";
import {
  GetProfileResponse,
  UpdateProfileBody,
  UpdateProfileResponse,
} from "@workspace/api-zod";
import { authSessionsTable, db, userProfilesTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { ensureReferralCode, getCurrencySettings } from "../lib/wallet";
import { hashPassword, verifyPassword } from "../lib/auth";

const router: IRouter = Router();
router.use(requireAuth);

router.get("/profile", async (_req, res): Promise<void> => {
  const userId = res.locals.userId as string;
  const referralCode = await ensureReferralCode(userId);
  const [profile] = await db
    .select()
    .from(userProfilesTable)
    .where(eq(userProfilesTable.userId, userId))
    .limit(1);
  if (!profile) {
    res.status(404).json({ error: "Profil tidak ditemukan." });
    return;
  }

  res.json(
    GetProfileResponse.parse({
      fullName: profile.fullName,
      username: profile.username,
      telegramUsername: profile.telegramUsername,
      language: profile.language,
      preferredCurrency: profile.preferredCurrency,
      referralCode,
    }),
  );
});

router.patch("/profile", async (req, res): Promise<void> => {
  const parsed = UpdateProfileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const userId = res.locals.userId as string;
  if (parsed.data.preferredCurrency) {
    const currencySettings = await getCurrencySettings();
    if (!currencySettings[parsed.data.preferredCurrency].enabled) {
      res.status(409).json({ error: "Mata uang ini sedang tidak tersedia." });
      return;
    }
  }
  const [profile] = await db
    .update(userProfilesTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(userProfilesTable.userId, userId))
    .returning();

  if (!profile) {
    res.status(404).json({ error: "Profil tidak ditemukan." });
    return;
  }

  res.json(
    UpdateProfileResponse.parse({
      fullName: profile.fullName,
      username: profile.username,
      telegramUsername: profile.telegramUsername,
      language: profile.language,
      preferredCurrency: profile.preferredCurrency,
      referralCode: profile.referralCode ?? "",
    }),
  );
});

router.patch("/profile/password", async (req, res): Promise<void> => {
  const parsed = ChangePasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const userId = res.locals.userId as string;
  const [profile] = await db.select({
    passwordHash: userProfilesTable.passwordHash,
  }).from(userProfilesTable)
    .where(eq(userProfilesTable.userId, userId))
    .limit(1);
  if (!profile?.passwordHash || !verifyPassword(parsed.data.currentPassword, profile.passwordHash)) {
    res.status(400).json({ error: "Kata sandi saat ini tidak sesuai." });
    return;
  }
  await db.update(userProfilesTable).set({
    passwordHash: hashPassword(parsed.data.newPassword),
    updatedAt: new Date(),
  }).where(eq(userProfilesTable.userId, userId));
  await db.delete(authSessionsTable).where(eq(authSessionsTable.userId, userId));
  res.clearCookie("sharewa_session", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });
  res.status(204).end();
});

export default router;
