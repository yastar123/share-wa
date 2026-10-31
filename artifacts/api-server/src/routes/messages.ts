import { and, desc, eq, inArray } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  ListMessagesQueryParams,
  ListMessagesResponse,
  SendMessageBatchBody,
  SendMessageBatchResponse,
  SendManualMessageBody,
  SendManualMessageResponse,
} from "@workspace/api-zod";
import { activityTable, contactsTable, db, messagesTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import {
  sendOneManualWhatsAppMessage,
  WhatsAppConnectionError,
} from "../lib/whatsapp";
import {
  getOutboundMessageLimits,
  isOutboundMessagingEnabled,
} from "../lib/system-settings";
import { reserveOutboundMessage } from "../lib/outbound-rate-limit";
import { awardMessageEarnings, awardReferralCommission } from "../lib/wallet";
import { createNotification } from "../lib/notifications";

const router: IRouter = Router();
router.use(requireAuth);

router.get("/messages", async (req, res): Promise<void> => {
  const parsed = ListMessagesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const filters = [eq(messagesTable.ownerUserId, res.locals.userId as string)];
  if (parsed.data.contactId) {
    filters.push(eq(messagesTable.contactId, parsed.data.contactId));
  }
  const rows = await db
    .select()
    .from(messagesTable)
    .where(and(...filters))
    .orderBy(desc(messagesTable.createdAt))
    .limit(parsed.data.limit);
  res.json(ListMessagesResponse.parse(rows));
});

router.post("/messages", async (req, res): Promise<void> => {
  const parsed = SendManualMessageBody.safeParse(req.body);
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
    res.status(503).json({ error: "Pengiriman pesan sedang dijeda oleh administrator." });
    return;
  }
  const userId = res.locals.userId as string;
  const messageLimits = await getOutboundMessageLimits();
  const [contact] = await db
    .select()
    .from(contactsTable)
    .where(and(
      eq(contactsTable.id, parsed.data.contactId),
      eq(contactsTable.ownerUserId, userId),
    ))
    .limit(1);
  if (!contact) {
    res.status(404).json({ error: "Kontak tidak ditemukan." });
    return;
  }
  if (contact.consentStatus !== "opted_in") {
    res.status(409).json({ error: "Izin kontak tidak aktif. Pesan tidak dikirim." });
    return;
  }

  const message = await reserveOutboundMessage({
    ownerUserId: userId,
    contactId: contact.id,
    contactName: contact.displayName,
    phone: contact.phone,
    text,
    maxMessagesPerHour: messageLimits.maxMessagesPerHour,
  });
  if (!message) {
    res.status(429).json({
      error: `Batas ${messageLimits.maxMessagesPerHour} pesan per jam telah tercapai.`,
    });
    return;
  }

  let whatsappMessageId: string | null;
  try {
    whatsappMessageId = await sendOneManualWhatsAppMessage(
      userId,
      contact.phone,
      text,
    );
  } catch (error) {
    await db
      .update(messagesTable)
      .set({ status: "failed" })
      .where(and(
        eq(messagesTable.id, message.id),
        eq(messagesTable.ownerUserId, userId),
      ));
    if (error instanceof WhatsAppConnectionError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    req.log.error({ err: error }, "Failed to send one-to-one WhatsApp message");
    throw error;
  }

  const [sent] = await db
    .update(messagesTable)
    .set({ status: "sent", whatsappMessageId })
    .where(and(
      eq(messagesTable.id, message.id),
      eq(messagesTable.ownerUserId, userId),
    ))
    .returning();
  if (!sent) {
    throw new Error("WhatsApp sent the message but its record could not be updated.");
  }
  await db.insert(activityTable).values({
    ownerUserId: userId,
    kind: "message_sent",
    summary: `Pesan dikirim kepada ${contact.displayName}.`,
  });
  await createNotification({
    ownerUserId: userId,
    kind: "message_sent",
    title: "Pesan terkirim",
    body: `Pesan ke ${contact.displayName} diterima untuk dikirim oleh WhatsApp.`,
  });
  await awardMessageEarnings(userId, sent.id);
  await awardReferralCommission(userId, sent.id);
  res.status(201).json(SendManualMessageResponse.parse(sent));
});

router.post("/messages/batch", async (req, res): Promise<void> => {
  const parsed = SendMessageBatchBody.safeParse(req.body);
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
    res.status(503).json({ error: "Pengiriman pesan sedang dijeda oleh administrator." });
    return;
  }
  const messageLimits = await getOutboundMessageLimits();
  if (parsed.data.contactIds.length > messageLimits.maxBatchSize) {
    res.status(400).json({
      error: `Satu batch maksimal berisi ${messageLimits.maxBatchSize} kontak.`,
    });
    return;
  }
  if (new Set(parsed.data.contactIds).size !== parsed.data.contactIds.length) {
    res.status(400).json({ error: "Kontak duplikat tidak dapat dimasukkan dalam satu batch." });
    return;
  }

  const userId = res.locals.userId as string;
  const contacts = await db
    .select()
    .from(contactsTable)
    .where(and(
      eq(contactsTable.ownerUserId, userId),
      inArray(contactsTable.id, parsed.data.contactIds),
    ));
  const contactsById = new Map(contacts.map((contact) => [contact.id, contact]));
  const targets = parsed.data.contactIds.map((id) => contactsById.get(id));
  if (targets.some((contact) => !contact)) {
    res.status(404).json({ error: "Satu atau beberapa kontak tidak ditemukan." });
    return;
  }
  const optedInTargets = targets.filter(
    (contact): contact is NonNullable<typeof contact> =>
      contact?.consentStatus === "opted_in",
  );
  if (optedInTargets.length !== targets.length) {
    res.status(409).json({
      error: "Semua kontak harus memiliki izin aktif. Tidak ada pesan yang dikirim.",
    });
    return;
  }

  const results: {
    contactId: string;
    contactName: string;
    status: "sent" | "failed" | "skipped";
    error?: string;
  }[] = [];

  for (const [index, requestedContact] of optedInTargets.entries()) {
    if (!requestedContact) continue;
    const [contact] = await db
      .select()
      .from(contactsTable)
      .where(and(
        eq(contactsTable.id, requestedContact.id),
        eq(contactsTable.ownerUserId, userId),
      ))
      .limit(1);
    if (!contact || contact.consentStatus !== "opted_in") {
      results.push({
        contactId: requestedContact.id,
        contactName: requestedContact.displayName,
        status: "skipped",
        error: "Izin kontak tidak lagi aktif.",
      });
      continue;
    }
    if (!(await isOutboundMessagingEnabled())) {
      results.push({
        contactId: contact.id,
        contactName: contact.displayName,
        status: "skipped",
        error: "Pengiriman pesan sedang dijeda oleh administrator.",
      });
      for (const remainingContact of optedInTargets.slice(index + 1)) {
        if (!remainingContact) continue;
        results.push({
          contactId: remainingContact.id,
          contactName: remainingContact.displayName,
          status: "skipped",
          error: "Pengiriman pesan sedang dijeda oleh administrator.",
        });
      }
      break;
    }

    const message = await reserveOutboundMessage({
      ownerUserId: userId,
      contactId: contact.id,
      contactName: contact.displayName,
      phone: contact.phone,
      text,
      maxMessagesPerHour: messageLimits.maxMessagesPerHour,
    });
    if (!message) {
      results.push({
        contactId: contact.id,
        contactName: contact.displayName,
        status: "skipped",
        error: `Batas ${messageLimits.maxMessagesPerHour} pesan per jam telah tercapai.`,
      });
      for (const remainingContact of optedInTargets.slice(index + 1)) {
        if (!remainingContact) continue;
        results.push({
          contactId: remainingContact.id,
          contactName: remainingContact.displayName,
          status: "skipped",
          error: `Batas ${messageLimits.maxMessagesPerHour} pesan per jam telah tercapai.`,
        });
      }
      break;
    }

    let whatsappMessageId: string | null;
    try {
      whatsappMessageId = await sendOneManualWhatsAppMessage(
        userId,
        contact.phone,
        text,
      );
    } catch (error) {
      await db
        .update(messagesTable)
        .set({ status: "failed" })
        .where(and(
          eq(messagesTable.id, message.id),
          eq(messagesTable.ownerUserId, userId),
        ));
      req.log.error({ err: error, contactId: contact.id }, "Failed to send batch WhatsApp message");
      results.push({
        contactId: contact.id,
        contactName: contact.displayName,
        status: "failed",
        error: error instanceof WhatsAppConnectionError
          ? error.message
          : "Pengiriman gagal. Periksa koneksi WhatsApp dan coba lagi nanti.",
      });
      for (const remainingContact of optedInTargets.slice(index + 1)) {
        if (!remainingContact) continue;
        results.push({
          contactId: remainingContact.id,
          contactName: remainingContact.displayName,
          status: "skipped",
          error: "Batch dihentikan setelah terjadi kegagalan.",
        });
      }
      break;
    }

    const [sent] = await db
      .update(messagesTable)
      .set({ status: "sent", whatsappMessageId })
      .where(and(
        eq(messagesTable.id, message.id),
        eq(messagesTable.ownerUserId, userId),
      ))
      .returning();
    if (!sent) {
      throw new Error("WhatsApp sent the batch message but its record could not be updated.");
    }
    await db.insert(activityTable).values({
      ownerUserId: userId,
      kind: "message_sent",
      summary: `Pesan dikirim kepada ${contact.displayName}.`,
    });
    await awardMessageEarnings(userId, sent.id);
    await awardReferralCommission(userId, sent.id);
    results.push({
      contactId: contact.id,
      contactName: contact.displayName,
      status: "sent",
    });

    if (index < optedInTargets.length - 1) {
      await new Promise((resolve) => setTimeout(
        resolve,
        messageLimits.delayBetweenMessagesMs,
      ));
    }
  }

  const sentCount = results.filter((result) => result.status === "sent").length;
  const failedCount = results.filter((result) => result.status === "failed").length;
  if (sentCount > 0 || failedCount > 0) {
    await createNotification({
      ownerUserId: userId,
      kind: failedCount > 0 ? "batch_attention" : "batch_sent",
      title: failedCount > 0 ? "Hasil batch perlu diperiksa" : "Batch selesai",
      body: `${sentCount} pesan diterima untuk dikirim; ${failedCount} gagal.`,
    });
  }

  res.json(SendMessageBatchResponse.parse({ results }));
});

export default router;
