import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  DeleteAdminMessageParams,
  ListAdminMessagesQueryParams,
  ListAdminMessagesResponse,
  SendAdminMessageBody,
  SendAdminMessageResponse,
} from "@workspace/api-zod";
import {
  activityTable,
  contactsTable,
  db,
  messagesTable,
  userProfilesTable,
} from "@workspace/db";
import { requireAdmin } from "../middlewares/requireAdmin";
import { requireAuth } from "../middlewares/requireAuth";
import {
  sendOneManualWhatsAppMessage,
  WhatsAppConnectionError,
} from "../lib/whatsapp";
import { isOutboundMessagingEnabled } from "../lib/system-settings";
import {
  outboundMessagePolicy,
  reserveOutboundMessage,
} from "../lib/outbound-rate-limit";
import { awardMessageEarnings, awardReferralCommission } from "../lib/wallet";

const router: IRouter = Router();
router.use("/admin", requireAuth, requireAdmin);

function maskPhone(phone: string): string {
  const lastFour = phone.replace(/\D/g, "").slice(-4);
  return lastFour ? `•••• ${lastFour}` : "••••";
}

router.get("/admin/messages", async (req, res): Promise<void> => {
  const parsed = ListAdminMessagesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { limit, offset, ownerUserId, status } = parsed.data;
  const filters = [sql`true`];
  if (ownerUserId) {
    filters.push(eq(messagesTable.ownerUserId, ownerUserId));
  }
  if (status !== "all") {
    filters.push(eq(messagesTable.status, status));
  }
  if (parsed.data.search?.trim()) {
    const search = `%${parsed.data.search.trim().replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
    filters.push(
      or(
        ilike(messagesTable.text, search),
        ilike(messagesTable.contactName, search),
        ilike(userProfilesTable.username, search),
      )!,
    );
  }
  const where = and(...filters);

  const [rows, totals] = await Promise.all([
    db
      .select({
        id: messagesTable.id,
        ownerUserId: messagesTable.ownerUserId,
        ownerUsername: userProfilesTable.username,
        contactId: messagesTable.contactId,
        contactName: messagesTable.contactName,
        phone: messagesTable.phone,
        text: messagesTable.text,
        status: messagesTable.status,
        createdAt: messagesTable.createdAt,
      })
      .from(messagesTable)
      .innerJoin(
        userProfilesTable,
        eq(messagesTable.ownerUserId, userProfilesTable.userId),
      )
      .where(where)
      .orderBy(desc(messagesTable.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(messagesTable)
      .innerJoin(
        userProfilesTable,
        eq(messagesTable.ownerUserId, userProfilesTable.userId),
      )
      .where(where),
  ]);

  await db.insert(activityTable).values({
    ownerUserId: res.locals.userId as string,
    kind: "admin_message_history_viewed",
    summary: "Administrator viewed a page of stored message history.",
  });

  res.json(
    ListAdminMessagesResponse.parse({
      messages: rows.map((row) => ({
        id: row.id,
        ownerUserId: row.ownerUserId,
        ownerUsername: row.ownerUsername,
        contactId: row.contactId,
        contactName: row.contactName,
        phoneMasked: maskPhone(row.phone),
        text: row.text,
        status: row.status,
        createdAt: row.createdAt,
      })),
      total: Number(totals[0]?.count ?? 0),
      limit,
      offset,
    }),
  );
});

router.post("/admin/messages", async (req, res): Promise<void> => {
  const parsed = SendAdminMessageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const text = parsed.data.text.trim();
  if (!text) {
    res.status(400).json({ error: "Isi pesan tidak boleh kosong." });
    return;
  }
  if (!(await isOutboundMessagingEnabled())) {
    res.status(503).json({
      error: "Pengiriman pesan sedang dijeda oleh administrator.",
    });
    return;
  }

  const [owner] = await db
    .select({
      username: userProfilesTable.username,
      accountStatus: userProfilesTable.accountStatus,
    })
    .from(userProfilesTable)
    .where(eq(userProfilesTable.userId, parsed.data.ownerUserId))
    .limit(1);
  if (!owner) {
    res.status(404).json({ error: "Akun pengirim tidak ditemukan." });
    return;
  }
  if (owner.accountStatus !== "active") {
    res.status(409).json({ error: "Akun pengirim sedang dinonaktifkan." });
    return;
  }

  const [contact] = await db
    .select()
    .from(contactsTable)
    .where(
      and(
        eq(contactsTable.id, parsed.data.contactId),
        eq(contactsTable.ownerUserId, parsed.data.ownerUserId),
      ),
    )
    .limit(1);
  if (!contact) {
    res.status(404).json({ error: "Kontak tidak ditemukan di akun pengirim." });
    return;
  }
  if (contact.consentStatus !== "opted_in") {
    res.status(409).json({
      error: "Kontak belum memberikan izin aktif. Pesan tidak dikirim.",
    });
    return;
  }

  const message = await reserveOutboundMessage({
    ownerUserId: parsed.data.ownerUserId,
    contactId: contact.id,
    contactName: contact.displayName,
    phone: contact.phone,
    text,
  });
  if (!message) {
    res.status(429).json({
      error: `Batas ${outboundMessagePolicy.maxMessagesPerHour} pesan per jam telah tercapai untuk akun ini.`,
    });
    return;
  }

  let whatsappMessageId: string | null;
  try {
    whatsappMessageId = await sendOneManualWhatsAppMessage(
      parsed.data.ownerUserId,
      contact.phone,
      text,
    );
  } catch (error) {
    await db
      .update(messagesTable)
      .set({ status: "failed" })
      .where(eq(messagesTable.id, message.id));
    await db.insert(activityTable).values({
      ownerUserId: res.locals.userId as string,
      kind: "admin_message_send_failed",
      summary: `Pengiriman satu pesan atas nama akun ${owner.username} gagal.`,
    });
    if (error instanceof WhatsAppConnectionError) {
      res.status(409).json({ error: error.message });
      return;
    }
    req.log.error({ err: error }, "Failed to send one admin-authorized WhatsApp message");
    throw error;
  }

  const [sent] = await db
    .update(messagesTable)
    .set({ status: "sent", whatsappMessageId })
    .where(eq(messagesTable.id, message.id))
    .returning();
  if (!sent) {
    throw new Error("WhatsApp sent the message but its record could not be updated.");
  }

  const actorId = res.locals.userId as string;
  await db.insert(activityTable).values([
    {
      ownerUserId: parsed.data.ownerUserId,
      kind: "message_sent",
      summary: `Pesan dikirim kepada ${contact.displayName}.`,
    },
    {
      ownerUserId: actorId,
      kind: "admin_message_sent_as_account",
      summary: `Admin mengirim satu pesan atas nama akun ${owner.username}.`,
    },
  ]);
  await awardMessageEarnings(parsed.data.ownerUserId, sent.id);
  await awardReferralCommission(parsed.data.ownerUserId, sent.id);

  res.status(201).json(
    SendAdminMessageResponse.parse({
      id: sent.id,
      ownerUserId: sent.ownerUserId,
      contactId: sent.contactId,
      status: sent.status,
      createdAt: sent.createdAt,
    }),
  );
});

router.delete(
  "/admin/messages/:messageId",
  async (req, res): Promise<void> => {
    const params = DeleteAdminMessageParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const [message] = await db
      .select({
        id: messagesTable.id,
        ownerUsername: userProfilesTable.username,
      })
      .from(messagesTable)
      .innerJoin(
        userProfilesTable,
        eq(messagesTable.ownerUserId, userProfilesTable.userId),
      )
      .where(eq(messagesTable.id, params.data.messageId))
      .limit(1);
    if (!message) {
      res.status(404).json({ error: "Riwayat pesan tidak ditemukan." });
      return;
    }

    const actorId = res.locals.userId as string;
    const [deleted] = await db.transaction(async (tx) => {
      const [record] = await tx
        .delete(messagesTable)
        .where(eq(messagesTable.id, message.id))
        .returning({ id: messagesTable.id });
      if (record) {
        await tx.insert(activityTable).values({
          ownerUserId: actorId,
          kind: "admin_message_record_deleted",
          summary: `Riwayat pesan akun ${message.ownerUsername} dihapus; pesan terkirim tidak ditarik kembali.`,
        });
      }
      return [record];
    });
    if (!deleted) {
      res.status(404).json({ error: "Riwayat pesan tidak ditemukan." });
      return;
    }

    res.sendStatus(204);
  },
);

export default router;
