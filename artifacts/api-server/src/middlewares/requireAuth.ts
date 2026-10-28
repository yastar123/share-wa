import type { RequestHandler } from "express";
import {
  authSessionsTable,
  db,
  userProfilesTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  AUTH_COOKIE_NAME,
  hashSessionToken,
} from "../lib/auth";

export const requireAuth: RequestHandler = async (req, res, next) => {
  try {
    const token = req.cookies?.[AUTH_COOKIE_NAME];
    if (typeof token !== "string" || token.length < 32) {
      res.status(401).json({ error: "Silakan masuk untuk melanjutkan." });
      return;
    }

    const tokenHash = hashSessionToken(token);
    const [session] = await db
      .select({
        id: authSessionsTable.id,
        userId: authSessionsTable.userId,
        expiresAt: authSessionsTable.expiresAt,
      })
      .from(authSessionsTable)
      .where(eq(authSessionsTable.tokenHash, tokenHash))
      .limit(1);

    if (!session || session.expiresAt.getTime() <= Date.now()) {
      if (session) {
        await db
          .delete(authSessionsTable)
          .where(eq(authSessionsTable.id, session.id));
      }
      res.clearCookie(AUTH_COOKIE_NAME, { path: "/" });
      res.status(401).json({ error: "Silakan masuk untuk melanjutkan." });
      return;
    }

    const [profile] = await db
      .select({
        userId: userProfilesTable.userId,
        accountStatus: userProfilesTable.accountStatus,
      })
      .from(userProfilesTable)
      .where(eq(userProfilesTable.userId, session.userId))
      .limit(1);

    if (!profile) {
      await db
        .delete(authSessionsTable)
        .where(eq(authSessionsTable.id, session.id));
      res.status(401).json({ error: "Silakan masuk untuk melanjutkan." });
      return;
    }

    if (profile.accountStatus !== "active") {
      await db
        .delete(authSessionsTable)
        .where(eq(authSessionsTable.id, session.id));
      res.status(403).json({
        error: "Akun ini sedang dinonaktifkan. Hubungi administrator.",
      });
      return;
    }

    res.locals.userId = session.userId;
    res.locals.sessionId = session.id;
    next();
  } catch (error) {
    next(error);
  }
};
