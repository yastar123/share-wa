import type { RequestHandler } from "express";
import { db, adminUsersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export async function ensureAdminAccess(userId: string): Promise<boolean> {
  const [existingRole] = await db
    .select({ userId: adminUsersTable.userId })
    .from(adminUsersTable)
    .where(eq(adminUsersTable.userId, userId))
    .limit(1);

  if (existingRole) return true;
  return false;
}

export const requireAdmin: RequestHandler = async (_req, res, next) => {
  try {
    const userId = res.locals.userId as string | undefined;
    if (!userId) {
      res.status(401).json({ error: "Silakan masuk untuk melanjutkan." });
      return;
    }

    if (!(await ensureAdminAccess(userId))) {
      res.status(403).json({ error: "Halaman ini hanya untuk administrator." });
      return;
    }

    next();
  } catch (error) {
    next(error);
  }
};
