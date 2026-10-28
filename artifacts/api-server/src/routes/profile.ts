import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import {
  GetProfileResponse,
  UpdateProfileBody,
  UpdateProfileResponse,
} from "@workspace/api-zod";
import { db, userProfilesTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();
router.use(requireAuth);

router.get("/profile", async (_req, res): Promise<void> => {
  const userId = res.locals.userId as string;
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
    }),
  );
});

export default router;
