import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  DeleteAdminContactParams,
  ListAdminContactsQueryParams,
  ListAdminContactsResponse,
  UpdateAdminContactBody,
  UpdateAdminContactParams,
  UpdateAdminContactResponse,
} from "@workspace/api-zod";
import {
  activityTable,
  consentEventsTable,
  contactsTable,
  db,
  userProfilesTable,
} from "@workspace/db";
import { requireAdmin } from "../middlewares/requireAdmin";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();
router.use("/admin", requireAuth, requireAdmin);

function maskPhone(phone: string): string {
  const lastFour = phone.replace(/\D/g, "").slice(-4);
  return lastFour ? `•••• ${lastFour}` : "••••";
}

router.get("/admin/contacts", async (req, res): Promise<void> => {
  const parsed = ListAdminContactsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { limit, offset, consentStatus } = parsed.data;
  const filters = [];
  if (consentStatus !== "all") {
    filters.push(eq(contactsTable.consentStatus, consentStatus));
  }
  if (parsed.data.search?.trim()) {
    const search = `%${parsed.data.search.trim().replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
    filters.push(
      or(
        ilike(contactsTable.displayName, search),
        ilike(contactsTable.phone, search),
        ilike(userProfilesTable.username, search),
      )!,
    );
  }
  const where = and(...filters);

  const [rows, totals] = await Promise.all([
    db
      .select({
        contactId: contactsTable.id,
        ownerUserId: contactsTable.ownerUserId,
        ownerUsername: userProfilesTable.username,
        displayName: contactsTable.displayName,
        phone: contactsTable.phone,
        consentStatus: contactsTable.consentStatus,
        consentSource: contactsTable.consentSource,
        consentedAt: contactsTable.consentedAt,
        optedOutAt: contactsTable.optedOutAt,
        createdAt: contactsTable.createdAt,
      })
      .from(contactsTable)
      .innerJoin(
        userProfilesTable,
        eq(contactsTable.ownerUserId, userProfilesTable.userId),
      )
      .where(where)
      .orderBy(desc(contactsTable.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(contactsTable)
      .innerJoin(
        userProfilesTable,
        eq(contactsTable.ownerUserId, userProfilesTable.userId),
      )
      .where(where),
  ]);

  res.json(
    ListAdminContactsResponse.parse({
      contacts: rows.map((row) => ({
        contactId: row.contactId,
        ownerUserId: row.ownerUserId,
        ownerUsername: row.ownerUsername,
        displayName: row.displayName,
        phoneMasked: maskPhone(row.phone),
        consentStatus: row.consentStatus,
        consentSource: row.consentSource,
        consentedAt: row.consentedAt,
        optedOutAt: row.optedOutAt,
        createdAt: row.createdAt,
      })),
      total: Number(totals[0]?.count ?? 0),
      limit,
      offset,
    }),
  );
});

router.patch(
  "/admin/contacts/:contactId",
  async (req, res): Promise<void> => {
    const params = UpdateAdminContactParams.safeParse(req.params);
    const body = UpdateAdminContactBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({
        error: params.error?.message ?? body.error?.message ?? "Permintaan tidak valid.",
      });
      return;
    }
    if (Object.keys(body.data).length === 0) {
      res.status(400).json({ error: "Pilih perubahan kontak yang akan disimpan." });
      return;
    }
    if (body.data.consentStatus === "opted_in" && !body.data.consentSource?.trim()) {
      res.status(400).json({
        error: "Catat sumber atau bukti izin sebelum mengaktifkan opt-in.",
      });
      return;
    }

    const [target] = await db
      .select({
        ownerUserId: contactsTable.ownerUserId,
        ownerUsername: userProfilesTable.username,
      })
      .from(contactsTable)
      .innerJoin(
        userProfilesTable,
        eq(contactsTable.ownerUserId, userProfilesTable.userId),
      )
      .where(eq(contactsTable.id, params.data.contactId))
      .limit(1);
    if (!target) {
      res.status(404).json({ error: "Kontak tidak ditemukan." });
      return;
    }

    const actorId = res.locals.userId as string;
    const [updated] = await db.transaction(async (tx) => {
      const changes: {
        displayName?: string;
        consentStatus?: "opted_in" | "opted_out" | "pending";
        consentSource?: string;
        consentedAt?: Date | null;
        optedOutAt?: Date | null;
        updatedAt: Date;
      } = { updatedAt: new Date() };

      if (body.data.displayName !== undefined) {
        changes.displayName = body.data.displayName.trim();
      }
      if (body.data.consentStatus !== undefined) {
        changes.consentStatus = body.data.consentStatus;
        changes.optedOutAt =
          body.data.consentStatus === "opted_out" ? new Date() : null;
        if (body.data.consentStatus === "opted_in") {
          changes.consentSource = body.data.consentSource!.trim();
          changes.consentedAt = new Date();
        }
      }

      const [contact] = await tx
        .update(contactsTable)
        .set(changes)
        .where(eq(contactsTable.id, params.data.contactId))
        .returning();
      if (!contact) return [];

      if (body.data.consentStatus !== undefined) {
        await tx.insert(consentEventsTable).values({
          ownerUserId: target.ownerUserId,
          contactId: contact.id,
          status: body.data.consentStatus,
          source:
            body.data.consentStatus === "opted_in"
              ? body.data.consentSource!.trim()
              : `Admin recorded ${body.data.consentStatus} status`,
        });
      }
      await tx.insert(activityTable).values({
        ownerUserId: actorId,
        kind: "admin_contact_updated",
        summary: `Data kontak akun ${target.ownerUsername} diperbarui oleh admin.`,
      });

      return [contact];
    });

    if (!updated) {
      res.status(404).json({ error: "Kontak tidak ditemukan." });
      return;
    }

    res.json(
      UpdateAdminContactResponse.parse({
        contactId: updated.id,
        ownerUserId: updated.ownerUserId,
        ownerUsername: target.ownerUsername,
        displayName: updated.displayName,
        phoneMasked: maskPhone(updated.phone),
        consentStatus: updated.consentStatus,
        consentSource: updated.consentSource,
        consentedAt: updated.consentedAt,
        optedOutAt: updated.optedOutAt,
        createdAt: updated.createdAt,
      }),
    );
  },
);

router.delete(
  "/admin/contacts/:contactId",
  async (req, res): Promise<void> => {
    const params = DeleteAdminContactParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const [target] = await db
      .select({
        ownerUserId: contactsTable.ownerUserId,
        ownerUsername: userProfilesTable.username,
      })
      .from(contactsTable)
      .innerJoin(
        userProfilesTable,
        eq(contactsTable.ownerUserId, userProfilesTable.userId),
      )
      .where(eq(contactsTable.id, params.data.contactId))
      .limit(1);
    if (!target) {
      res.status(404).json({ error: "Kontak tidak ditemukan." });
      return;
    }

    const actorId = res.locals.userId as string;
    const [deleted] = await db.transaction(async (tx) => {
      const [contact] = await tx
        .delete(contactsTable)
        .where(eq(contactsTable.id, params.data.contactId))
        .returning({ id: contactsTable.id });
      if (contact) {
        await tx.insert(activityTable).values({
          ownerUserId: actorId,
          kind: "admin_contact_deleted",
          summary: `Kontak akun ${target.ownerUsername} dan riwayat terkait dihapus oleh admin.`,
        });
      }
      return [contact];
    });
    if (!deleted) {
      res.status(404).json({ error: "Kontak tidak ditemukan." });
      return;
    }

    res.sendStatus(204);
  },
);

export default router;
