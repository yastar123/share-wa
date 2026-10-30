import { desc, eq, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  DeleteAdminUserParams,
  DeleteAdminUserResponse,
  GetAdminMeResponse,
  GetAdminOverviewResponse,
  GetAdminSystemSettingsResponse,
  ListAdminUsersQueryParams,
  ListAdminUsersResponse,
  UpdateAdminUserStatusBody,
  UpdateAdminUserStatusParams,
  UpdateAdminUserStatusResponse,
  UpdateAdminUserRoleBody,
  UpdateAdminUserRoleParams,
  UpdateAdminUserRoleResponse,
  UpdateAdminSystemSettingsBody,
  UpdateAdminSystemSettingsResponse,
} from "@workspace/api-zod";
import {
  activityTable,
  adminUsersTable,
  contactsTable,
  db,
  messagesTable,
  systemSettingsTable,
  userProfilesTable,
  whatsappSessionsTable,
} from "@workspace/db";
import { requireAdmin, ensureAdminAccess } from "../middlewares/requireAdmin";
import { requireAuth } from "../middlewares/requireAuth";
import { disconnectWhatsApp } from "../lib/whatsapp";
import { getCurrencySettings } from "../lib/wallet";

const router: IRouter = Router();

router.get("/admin/me", requireAuth, async (_req, res): Promise<void> => {
  const userId = res.locals.userId as string;
  const isAdmin = await ensureAdminAccess(userId);
  res.json(GetAdminMeResponse.parse({ isAdmin }));
});

const adminRouter: IRouter = Router();
adminRouter.use("/admin", requireAuth, requireAdmin);

adminRouter.get("/admin/system", async (_req, res): Promise<void> => {
  const [settings] = await db
    .select({
      outboundMessagingEnabled: systemSettingsTable.outboundMessagingEnabled,
      currencySettings: systemSettingsTable.currencySettings,
      updatedAt: systemSettingsTable.updatedAt,
    })
    .from(systemSettingsTable)
    .where(eq(systemSettingsTable.id, 1))
    .limit(1);

  const currencySettings = await getCurrencySettings();
  res.json(
    GetAdminSystemSettingsResponse.parse({
      outboundMessagingEnabled: settings?.outboundMessagingEnabled ?? true,
      currencySettings,
      updatedAt: settings?.updatedAt ?? null,
    }),
  );
});

adminRouter.patch("/admin/system", async (req, res): Promise<void> => {
  const body = UpdateAdminSystemSettingsBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const currencySettings = body.data.currencySettings ?? await getCurrencySettings();
  for (const currency of ["IDR", "USD", "CNY"] as const) {
    const setting = currencySettings[currency];
    if (
      !setting ||
      typeof setting.enabled !== "boolean" ||
      !Number.isSafeInteger(setting.minimumWithdrawal) ||
      setting.minimumWithdrawal < 1 ||
      !Number.isSafeInteger(setting.earningPerMessage) ||
      setting.earningPerMessage < 0 ||
      !Number.isSafeInteger(setting.commissionPerMessage) ||
      setting.commissionPerMessage < 0
    ) {
      res.status(400).json({ error: `Pengaturan ${currency} tidak valid.` });
      return;
    }
  }

  const updatedAt = new Date();
  const [existing] = await db
    .select({ id: systemSettingsTable.id })
    .from(systemSettingsTable)
    .where(eq(systemSettingsTable.id, 1))
    .limit(1);
  if (existing) {
    await db
      .update(systemSettingsTable)
      .set({
        outboundMessagingEnabled: body.data.outboundMessagingEnabled,
        currencySettings,
        updatedByUserId: res.locals.userId as string,
        updatedAt,
      })
      .where(eq(systemSettingsTable.id, 1));
  } else {
    await db.insert(systemSettingsTable).values({
      id: 1,
      outboundMessagingEnabled: body.data.outboundMessagingEnabled,
      currencySettings,
      updatedByUserId: res.locals.userId as string,
      updatedAt,
    });
  }

  await db.insert(activityTable).values({
    ownerUserId: res.locals.userId as string,
    kind: "admin_system_setting_updated",
    summary: body.data.outboundMessagingEnabled
      ? "Pengiriman pesan keluar dilanjutkan oleh admin."
      : "Pengiriman pesan keluar dijeda oleh admin.",
  });

  res.json(
    UpdateAdminSystemSettingsResponse.parse({
      outboundMessagingEnabled: body.data.outboundMessagingEnabled,
      currencySettings,
      updatedAt,
    }),
  );
});

adminRouter.get("/admin/overview", async (_req, res): Promise<void> => {
  const [
    userRows,
    adminRows,
    suspendedRows,
    deletionPendingRows,
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
      .from(adminUsersTable)
      .innerJoin(
        userProfilesTable,
        eq(adminUsersTable.userId, userProfilesTable.userId),
      )
      .where(eq(userProfilesTable.accountStatus, "active")),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(userProfilesTable)
      .where(eq(userProfilesTable.accountStatus, "suspended")),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(userProfilesTable)
      .where(eq(userProfilesTable.accountStatus, "deletion_pending")),
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
        eq(userProfilesTable.userId, whatsappSessionsTable.ownerUserId),
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
        eq(activityTable.ownerUserId, userProfilesTable.userId),
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
      suspendedUsers: Number(suspendedRows[0]?.count ?? 0),
      deletionPendingUsers: Number(deletionPendingRows[0]?.count ?? 0),
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
        userId: userProfilesTable.userId,
        email: userProfilesTable.email,
        fullName: userProfilesTable.fullName,
        username: userProfilesTable.username,
        language: userProfilesTable.language,
        accountStatus: userProfilesTable.accountStatus,
        isAdmin: adminUsersTable.userId,
        connectionStatus: whatsappSessionsTable.status,
        createdAt: userProfilesTable.createdAt,
      })
      .from(userProfilesTable)
      .leftJoin(
        adminUsersTable,
        eq(userProfilesTable.userId, adminUsersTable.userId),
      )
      .leftJoin(
        whatsappSessionsTable,
        eq(userProfilesTable.userId, whatsappSessionsTable.ownerUserId),
      )
      .orderBy(desc(userProfilesTable.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(userProfilesTable),
  ]);

  res.json(
    ListAdminUsersResponse.parse({
      users: rows.map((row) => ({
        userId: row.userId,
        email: row.email,
        fullName: row.fullName,
        username: row.username,
        language: row.language,
        accountStatus: row.accountStatus,
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
        userId: userProfilesTable.userId,
        username: userProfilesTable.username,
        accountStatus: userProfilesTable.accountStatus,
      })
      .from(userProfilesTable)
      .where(eq(userProfilesTable.userId, targetUserId))
      .limit(1);
    if (!target) {
      res.status(404).json({ error: "Akun tidak ditemukan." });
      return;
    }

    if (wantsAdmin && target.accountStatus !== "active") {
      res.status(409).json({
        error: "Hanya akun aktif yang dapat diberi peran admin.",
      });
      return;
    }

    const roleResult = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(190131039)`);
      const [currentRole] = await tx
        .select({ userId: adminUsersTable.userId })
        .from(adminUsersTable)
        .where(eq(adminUsersTable.userId, targetUserId))
        .limit(1);

      if (wantsAdmin) {
        if (!currentRole) {
          const [createdRole] = await tx
            .insert(adminUsersTable)
            .values({
              userId: targetUserId,
              grantedByUserId: actorId,
            })
            .onConflictDoNothing()
            .returning({ userId: adminUsersTable.userId });

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
        .from(adminUsersTable)
        .innerJoin(
          userProfilesTable,
          eq(adminUsersTable.userId, userProfilesTable.userId),
        )
        .where(eq(userProfilesTable.accountStatus, "active"));
      if (Number(adminCount?.count ?? 0) <= 1) {
        return { isAdmin: true, lastAdmin: true };
      }

      await tx
        .delete(adminUsersTable)
        .where(eq(adminUsersTable.userId, targetUserId));
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

adminRouter.patch(
  "/admin/users/:userId/status",
  async (req, res): Promise<void> => {
    const params = UpdateAdminUserStatusParams.safeParse(req.params);
    const body = UpdateAdminUserStatusBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({
        error: params.error?.message ?? body.error?.message ?? "Permintaan tidak valid.",
      });
      return;
    }

    const actorId = res.locals.userId as string;
    const userId = params.data.userId;
    if (userId === actorId && body.data.status === "suspended") {
      res.status(409).json({
        error: "Gunakan akun administrator lain untuk menonaktifkan akun Anda.",
      });
      return;
    }

    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(190131039)`);
      const [target] = await tx
        .select({
          username: userProfilesTable.username,
          accountStatus: userProfilesTable.accountStatus,
        })
        .from(userProfilesTable)
        .where(eq(userProfilesTable.userId, userId))
        .limit(1);
      if (!target) return { error: "not_found" as const };
      if (target.accountStatus === "deletion_pending") {
        return { error: "deletion_pending" as const };
      }
      if (target.accountStatus === body.data.status) {
        return { status: body.data.status };
      }

      const [role] = await tx
        .select({ userId: adminUsersTable.userId })
        .from(adminUsersTable)
        .where(eq(adminUsersTable.userId, userId))
        .limit(1);
      if (
        body.data.status === "suspended" &&
        target.accountStatus === "active" &&
        role
      ) {
        const [activeAdminCount] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(adminUsersTable)
          .innerJoin(
            userProfilesTable,
            eq(adminUsersTable.userId, userProfilesTable.userId),
          )
          .where(eq(userProfilesTable.accountStatus, "active"));
        if (Number(activeAdminCount?.count ?? 0) <= 1) {
          return { error: "last_admin" as const };
        }
      }

      await tx
        .update(userProfilesTable)
        .set({ accountStatus: body.data.status, updatedAt: new Date() })
        .where(eq(userProfilesTable.userId, userId));
      await tx.insert(activityTable).values({
        ownerUserId: actorId,
        kind:
          body.data.status === "suspended"
            ? "admin_account_suspended"
            : "admin_account_reactivated",
        summary:
          body.data.status === "suspended"
            ? `Akun ${target.username} dinonaktifkan.`
            : `Akun ${target.username} diaktifkan kembali.`,
      });
      return { status: body.data.status };
    });

    if ("error" in result) {
      if (result.error === "not_found") {
        res.status(404).json({ error: "Akun tidak ditemukan." });
        return;
      }
      res.status(409).json({
        error:
          result.error === "last_admin"
            ? "Administrator aktif terakhir tidak dapat dinonaktifkan."
            : "Akun sedang menunggu penghapusan permanen.",
      });
      return;
    }

    if (result.status === "suspended") {
      try {
        await disconnectWhatsApp(userId);
      } catch (error) {
        req.log.error({ err: error, userId }, "Failed to disconnect suspended user's WhatsApp");
      }
    }

    res.json(
      UpdateAdminUserStatusResponse.parse({
        userId,
        status: result.status,
      }),
    );
  },
);

adminRouter.delete(
  "/admin/users/:userId",
  async (req, res): Promise<void> => {
    const params = DeleteAdminUserParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const actorId = res.locals.userId as string;
    const userId = params.data.userId;
    if (userId === actorId) {
      res.status(409).json({
        error: "Gunakan akun administrator lain untuk menghapus akun Anda.",
      });
      return;
    }

    const markResult = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(190131039)`);
      const [target] = await tx
        .select({
          username: userProfilesTable.username,
          accountStatus: userProfilesTable.accountStatus,
        })
        .from(userProfilesTable)
        .where(eq(userProfilesTable.userId, userId))
        .limit(1);
      if (!target) return "not_found" as const;
      if (target.accountStatus === "deletion_pending") return "pending" as const;

      const [role] = await tx
        .select({ userId: adminUsersTable.userId })
        .from(adminUsersTable)
        .where(eq(adminUsersTable.userId, userId))
        .limit(1);
      if (target.accountStatus === "active" && role) {
        const [activeAdminCount] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(adminUsersTable)
          .innerJoin(
            userProfilesTable,
            eq(adminUsersTable.userId, userProfilesTable.userId),
          )
          .where(eq(userProfilesTable.accountStatus, "active"));
        if (Number(activeAdminCount?.count ?? 0) <= 1) return "last_admin" as const;
      }

      await tx
        .update(userProfilesTable)
        .set({ accountStatus: "deletion_pending", updatedAt: new Date() })
        .where(eq(userProfilesTable.userId, userId));
      await tx.insert(activityTable).values({
        ownerUserId: actorId,
        kind: "admin_account_deletion_started",
        summary: `Penghapusan akun ${target.username} dimulai.`,
      });
      return "pending" as const;
    });

    if (markResult === "not_found") {
      res.status(404).json({ error: "Akun tidak ditemukan." });
      return;
    }
    if (markResult === "last_admin") {
      res.status(409).json({
        error: "Administrator aktif terakhir tidak dapat dihapus.",
      });
      return;
    }

    try {
      await disconnectWhatsApp(userId);
    } catch (error) {
      req.log.error({ err: error, userId }, "Failed to disconnect WhatsApp during account deletion");
      res.status(202).json(
        DeleteAdminUserResponse.parse({ userId, status: "deletion_pending" }),
      );
      return;
    }

    await db.transaction(async (tx) => {
      await tx.insert(activityTable).values({
        ownerUserId: actorId,
        kind: "admin_account_deleted",
        summary: "Akun dan data terkait dihapus secara permanen.",
      });
      await tx
        .delete(userProfilesTable)
        .where(eq(userProfilesTable.userId, userId));
    });

    res.json(
      DeleteAdminUserResponse.parse({ userId, status: "deleted" }),
    );
  },
);

router.use(adminRouter);

export default router;
