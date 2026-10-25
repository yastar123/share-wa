import { and, desc, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  ListMessagesQueryParams,
  ListMessagesResponse,
  SendManualMessageBody,
  SendManualMessageResponse,
} from "@workspace/api-zod";
import { activityTable, contactsTable, db, messagesTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import {
  sendOneManualWhatsAppMessage,
  WhatsAppConnectionError,
} from "../lib/whatsapp";

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

  const userId = res.locals.userId as string;
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

  const [message] = await db
    .insert(messagesTable)
    .values({
      ownerUserId: userId,
      contactId: contact.id,
      contactName: contact.displayName,
      phone: contact.phone,
      text,
      status: "queued",
    })
    .returning();
  if (!message) {
    res.status(500).json({ error: "Pesan tidak dapat disimpan." });
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
  res.status(201).json(SendManualMessageResponse.parse(sent));
});

export default router;
