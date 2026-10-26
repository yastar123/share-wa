import { clerkClient } from "@clerk/express";
import { desc, eq, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  GetAdminMeResponse,
  GetAdminOverviewResponse,
  ListAdminUsersQueryParams,
  ListAdminUsersResponse,
  UpdateAdminUserRoleBody,
  UpdateAdminUserRoleParams,
  UpdateAdminUserRoleResponse,
} from "@workspace/api-zod";
import {
  activityTable,
  adminUsersTable,
  contactsTable,
  db,
  messagesTable,
  userProfilesTable,
  whatsappSessionsTable,
} from "@workspace/db";
import { requireAdmin, ensureAdminAccess } from "../middlewares/requireAdmin";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();
router.get("/admin/me", requireAuth, async (_req, res): Promise<void> => {
  const userId = res.locals.userId as string;
  const isAdmin = await ensureAdminAccess(userId);
  res.json(GetAdminMeResponse.parse({ isAdmin }));
});

const adminRouter: IRouter = Router();
adminRouter.use(requireAuth, requireAdmin);

adminRouter.get("/admin/overview", async (_req, res): Promise<void> => {
  const [
    userRows,
    adminRows,
    contactRows,
    messageRows,
    connectionRows,
    recentActivity,
  ] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(userProfilesTable),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(adminUsersTable),
    db
      .select({
        status: contactsTable.consentStatus,
        count: sql<number>`count(*)::int`,
      })
      .from(contactsTable)
      .groupBy(contactsTable.consentStatus),
    db
      .select({
        status: messagesTable.status,
        count: sql<number>`count(*)::int`,
      })
      .from(messagesTable)
      .groupBy(messagesTable.status),
    db
      .select({
        status: sql<string>`coalesce(${whatsappSessionsTable.status}::text, 'disconnected')`,
        count: sql<number>`count(*)::int`,
      })
      .from(userProfilesTable)
      .leftJoin(
        whatsappSessionsTable,
        eq(userProfilesTable.clerkUserId, whatsappSessionsTable.ownerUserId),
      )
      .groupBy(
        sql`coalesce(${whatsappSessionsTable.status}::text, 'disconnected')`,
      ),
    db
      .select({
        id: activityTable.id,
        userId: activityTable.ownerUserId,
        username: userProfilesTable.username,
        kind: activityTable.kind,
        createdAt: activityTable.createdAt,
      })
      .from(activityTable)
      .innerJoin(
        userProfilesTable,
        eq(activityTable.ownerUserId, userProfilesTable.clerkUserId),
      )
      .orderBy(desc(activityTable.createdAt))
      .limit(20),
  ]);

  const contacts = new Map(
    contactRows.map((row) => [row.status, Number(row.count)]),
  );
  const messages = new Map(
    messageRows.map((row) => [row.status, Number(row.count)]),
  );
  const connections = new Map(
    connectionRows.map((row) => [row.status, Number(row.count)]),
  );

  res.json(
    GetAdminOverviewResponse.parse({
      totalUsers: Number(userRows[0]?.count ?? 0),
      totalAdmins: Number(adminRows[0]?.count ?? 0),
      totalContacts: [...contacts.values()].reduce((sum, count) => sum + count, 0),
      optedInContacts: contacts.get("opted_in") ?? 0,
      optedOutContacts: contacts.get("opted_out") ?? 0,
      pendingContacts: contacts.get("pending") ?? 0,
      totalMessages: [...messages.values()].reduce((sum, count) => sum + count, 0),
      sentMessages: messages.get("sent") ?? 0,
      deliveredMessages: messages.get("delivered") ?? 0,
      failedMessages: messages.get("failed") ?? 0,
      connections: {
        connected: connections.get("connected") ?? 0,
        disconnected: connections.get("disconnected") ?? 0,
        awaitingLink: connections.get("awaiting_link") ?? 0,
        reconnecting: connections.get("reconnecting") ?? 0,
        error: connections.get("error") ?? 0,
      },
      recentActivity,
    }),
  );
});

adminRouter.get("/admin/users", async (req, res): Promise<void> => {
  const query = ListAdminUsersQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const { limit, offset } = query.data;
  const [rows, totalRows] = await Promise.all([
    db
      .select({
        userId: userProfilesTable.clerkUserId,
        fullName: userProfilesTable.fullName,
        username: userProfilesTable.username,
        language: userProfilesTable.language,
        isAdmin: adminUsersTable.clerkUserId,
        connectionStatus: whatsappSessionsTable.status,
        createdAt: userProfilesTable.createdAt,
      })
      .from(userProfilesTable)
      .leftJoin(
        adminUsersTable,
        eq(userProfilesTable.clerkUserId, adminUsersTable.clerkUserId),
      )
      .leftJoin(
        whatsappSessionsTable,
        eq(userProfilesTable.clerkUserId, whatsappSessionsTable.ownerUserId),
      )
      .orderBy(desc(userProfilesTable.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(userProfilesTable),
  ]);

  const clerkUsers =
    rows.length > 0
      ? await clerkClient.users.getUserList({
          userId: rows.map((row) => row.userId),
          limit: rows.length,
        })
      : { data: [] };
  const primaryEmails = new Map(
    clerkUsers.data.map((user) => [
      user.id,
      user.emailAddresses.find(
        (email) => email.id === user.primaryEmailAddressId,
      )?.emailAddress ?? null,
    ]),
  );

  res.json(
    ListAdminUsersResponse.parse({
      users: rows.map((row) => ({
        userId: row.userId,
        email: primaryEmails.get(row.userId) ?? null,
        fullName: row.fullName,
        username: row.username,
        language: row.language,
        isAdmin: Boolean(row.isAdmin),
        connectionStatus: row.connectionStatus ?? "disconnected",
        createdAt: row.createdAt,
      })),
      total: Number(totalRows[0]?.count ?? 0),
      limit,
      offset,
    }),
  );
});

adminRouter.patch(
  "/admin/users/:userId/role",
  async (req, res): Promise<void> => {
    const params = UpdateAdminUserRoleParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const body = UpdateAdminUserRoleBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }

    const actorId = res.locals.userId as string;
    const targetUserId = params.data.userId;
    const wantsAdmin = body.data.isAdmin;
    if (!wantsAdmin && targetUserId === actorId) {
      res.status(400).json({
        error: "Gunakan akun administrator lain untuk mengubah peran Anda.",
      });
      return;
    }

    const [target] = await db
      .select({
        userId: userProfilesTable.clerkUserId,
        username: userProfilesTable.username,
      })
      .from(userProfilesTable)
      .where(eq(userProfilesTable.clerkUserId, targetUserId))
      .limit(1);
    if (!target) {
      res.status(404).json({ error: "Akun tidak ditemukan." });
      return;
    }

    if (wantsAdmin) {
      const clerkUser = await clerkClient.users.getUser(targetUserId);
      const hasVerifiedEmail = clerkUser.emailAddresses.some(
        (email) => email.verification?.status === "verified",
      );
      if (!hasVerifiedEmail) {
        res.status(400).json({
          error: "Akun harus memiliki email terverifikasi sebelum menjadi admin.",
        });
        return;
      }
    }

    const roleResult = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(190131039)`);
      const [currentRole] = await tx
        .select({ clerkUserId: adminUsersTable.clerkUserId })
        .from(adminUsersTable)
        .where(eq(adminUsersTable.clerkUserId, targetUserId))
        .limit(1);

      if (wantsAdmin) {
        if (!currentRole) {
          const [createdRole] = await tx
            .insert(adminUsersTable)
            .values({
              clerkUserId: targetUserId,
              grantedByUserId: actorId,
            })
            .onConflictDoNothing()
            .returning({ clerkUserId: adminUsersTable.clerkUserId });

          if (createdRole) {
            await tx.insert(activityTable).values({
              ownerUserId: actorId,
              kind: "admin_role_granted",
              summary: `Peran admin diberikan kepada ${target.username}.`,
            });
          }
        }
        return { isAdmin: true, lastAdmin: false };
      }

      if (!currentRole) return { isAdmin: false, lastAdmin: false };

      const [adminCount] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(adminUsersTable);
      if (Number(adminCount?.count ?? 0) <= 1) {
        return { isAdmin: true, lastAdmin: true };
      }

      await tx
        .delete(adminUsersTable)
        .where(eq(adminUsersTable.clerkUserId, targetUserId));
      await tx.insert(activityTable).values({
        ownerUserId: actorId,
        kind: "admin_role_revoked",
        summary: `Peran admin dicabut dari ${target.username}.`,
      });
      return { isAdmin: false, lastAdmin: false };
    });

    if (roleResult.lastAdmin) {
      res.status(409).json({
        error: "Setidaknya satu administrator harus tetap aktif.",
      });
      return;
    }

    res.json(
      UpdateAdminUserRoleResponse.parse({
        userId: targetUserId,
        isAdmin: roleResult.isAdmin,
      }),
    );
  },
);

router.use(adminRouter);

export default router;
