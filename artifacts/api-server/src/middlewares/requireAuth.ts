import { getAuth } from "@clerk/express";
import type { RequestHandler } from "express";
import { db, userProfilesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export const requireAuth: RequestHandler = async (req, res, next) => {
  try {
    const userId = getAuth(req).userId;
    if (!userId) {
      res.status(401).json({ error: "Silakan masuk untuk melanjutkan." });
      return;
    }

    const [existing] = await db
      .select({ clerkUserId: userProfilesTable.clerkUserId })
      .from(userProfilesTable)
      .where(eq(userProfilesTable.clerkUserId, userId))
      .limit(1);

    if (!existing) {
      const safeSuffix = userId
        .replace(/[^a-zA-Z0-9_]/g, "")
        .toLowerCase()
        .slice(-20);
      await db
        .insert(userProfilesTable)
        .values({
          clerkUserId: userId,
          fullName: "Pengguna baru",
          username: `u_${safeSuffix || "sharewa"}`,
          language: "id",
        })
        .onConflictDoNothing();
    }

    res.locals.userId = userId;
    next();
  } catch (error) {
    next(error);
  }
};
