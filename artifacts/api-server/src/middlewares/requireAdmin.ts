import { clerkClient } from "@clerk/express";
import type { RequestHandler } from "express";
import { db, activityTable, adminUsersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export async function ensureAdminAccess(userId: string): Promise<boolean> {
  const [existingRole] = await db
    .select({ clerkUserId: adminUsersTable.clerkUserId })
    .from(adminUsersTable)
    .where(eq(adminUsersTable.clerkUserId, userId))
    .limit(1);

  if (existingRole) return true;

  const [anyAdmin] = await db
    .select({ clerkUserId: adminUsersTable.clerkUserId })
    .from(adminUsersTable)
    .limit(1);

  if (anyAdmin) return false;

  const bootstrapEmail = process.env.SHAREWA_INITIAL_ADMIN_EMAIL
    ?.trim()
    .toLowerCase();
  if (!bootstrapEmail) return false;

  const user = await clerkClient.users.getUser(userId);
  const ownsVerifiedEmail = user.emailAddresses.some(
    (email) =>
      email.emailAddress.trim().toLowerCase() === bootstrapEmail &&
      email.verification?.status === "verified",
  );
  if (!ownsVerifiedEmail) return false;

  const [createdRole] = await db
    .insert(adminUsersTable)
    .values({ clerkUserId: userId })
    .onConflictDoNothing()
    .returning({ clerkUserId: adminUsersTable.clerkUserId });

  if (createdRole) {
    await db.insert(activityTable).values({
      ownerUserId: userId,
      kind: "admin_role_granted",
      summary: "Peran admin awal diaktifkan.",
    });
  }

  const [confirmedRole] = await db
    .select({ clerkUserId: adminUsersTable.clerkUserId })
    .from(adminUsersTable)
    .where(eq(adminUsersTable.clerkUserId, userId))
    .limit(1);

  return Boolean(confirmedRole);
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
