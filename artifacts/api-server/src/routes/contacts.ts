import { and, desc, eq, ilike, or } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CreateContactBody,
  CreateContactResponse,
  DeleteContactParams,
  ListContactsQueryParams,
  ListContactsResponse,
  UpdateContactBody,
  UpdateContactConsentBody,
  UpdateContactConsentParams,
  UpdateContactConsentResponse,
  UpdateContactParams,
  UpdateContactResponse,
} from "@workspace/api-zod";
import {
  activityTable,
  consentEventsTable,
  contactsTable,
  db,
} from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();
router.use(requireAuth);

router.get("/contacts", async (req, res): Promise<void> => {
  const parsed = ListContactsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const userId = res.locals.userId as string;
  const filters = [eq(contactsTable.ownerUserId, userId)];
  if (parsed.data.consent !== "all") {
    filters.push(eq(contactsTable.consentStatus, parsed.data.consent));
  }
  if (parsed.data.search?.trim()) {
    const search = `%${parsed.data.search.trim().replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
    filters.push(or(
      ilike(contactsTable.displayName, search),
      ilike(contactsTable.phone, search),
    )!);
  }

  const rows = await db
    .select()
    .from(contactsTable)
    .where(and(...filters))
    .orderBy(desc(contactsTable.createdAt));

  res.json(ListContactsResponse.parse(rows));
});

router.post("/contacts", async (req, res): Promise<void> => {
  const parsed = CreateContactBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (!parsed.data.consentConfirmed) {
    res.status(400).json({ error: "Konfirmasi izin kontak diperlukan." });
    return;
  }

  const userId = res.locals.userId as string;
  const phone = parsed.data.phone.replace(/[^\d+]/g, "");
  if (phone.replace(/\D/g, "").length < 7 || phone.replace(/\D/g, "").length > 15) {
    res.status(400).json({ error: "Masukkan nomor telepon lengkap dengan kode negara." });
    return;
  }

  try {
    const contact = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(contactsTable)
        .values({
          ownerUserId: userId,
          displayName: parsed.data.displayName.trim(),
          phone,
          consentStatus: "opted_in",
          consentSource: parsed.data.consentSource.trim(),
          consentedAt: new Date(),
        })
        .returning();
      if (!created) throw new Error("Contact was not created.");

      await tx.insert(consentEventsTable).values({
        ownerUserId: userId,
        contactId: created.id,
        status: "opted_in",
        source: parsed.data.consentSource.trim(),
      });
      await tx.insert(activityTable).values({
        ownerUserId: userId,
        kind: "contact_added",
        summary: `Kontak ${created.displayName} ditambahkan dengan izin tercatat.`,
      });

      return created;
    });

    res.status(201).json(CreateContactResponse.parse(contact));
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      res.status(409).json({ error: "Nomor ini sudah ada di daftar kontak Anda." });
      return;
    }
    req.log.error({ err: error }, "Failed to create contact");
    throw error;
  }
});

router.patch("/contacts/:contactId", async (req, res): Promise<void> => {
  const params = UpdateContactParams.safeParse(req.params);
  const body = UpdateContactBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({
      error: params.error?.message ?? body.error?.message ?? "Permintaan tidak valid.",
    });
    return;
  }

  const [contact] = await db
    .update(contactsTable)
    .set({ displayName: body.data.displayName.trim(), updatedAt: new Date() })
    .where(and(
      eq(contactsTable.id, params.data.contactId),
      eq(contactsTable.ownerUserId, res.locals.userId as string),
    ))
    .returning();
  if (!contact) {
    res.status(404).json({ error: "Kontak tidak ditemukan." });
    return;
  }
  res.json(UpdateContactResponse.parse(contact));
});

router.delete("/contacts/:contactId", async (req, res): Promise<void> => {
  const params = DeleteContactParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [deleted] = await db
    .delete(contactsTable)
    .where(and(
      eq(contactsTable.id, params.data.contactId),
      eq(contactsTable.ownerUserId, res.locals.userId as string),
    ))
    .returning({ id: contactsTable.id });
  if (!deleted) {
    res.status(404).json({ error: "Kontak tidak ditemukan." });
    return;
  }
  res.sendStatus(204);
});

router.patch("/contacts/:contactId/consent", async (req, res): Promise<void> => {
  const params = UpdateContactConsentParams.safeParse(req.params);
  const body = UpdateContactConsentBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({
      error: params.error?.message ?? body.error?.message ?? "Permintaan tidak valid.",
    });
    return;
  }
  if (body.data.status === "opted_in" && !body.data.source?.trim()) {
    res.status(400).json({ error: "Catat sumber izin sebelum mengaktifkan kembali kontak." });
    return;
  }

  const userId = res.locals.userId as string;
  const [contact] = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(contactsTable)
      .set({
        consentStatus: body.data.status,
        ...(body.data.status === "opted_in"
          ? { consentSource: body.data.source!.trim(), consentedAt: new Date() }
          : {}),
        optedOutAt: body.data.status === "opted_out" ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(and(
        eq(contactsTable.id, params.data.contactId),
        eq(contactsTable.ownerUserId, userId),
      ))
      .returning();
    if (!updated) return [];

    await tx.insert(consentEventsTable).values({
      ownerUserId: userId,
      contactId: updated.id,
      status: body.data.status,
      source: body.data.status === "opted_in"
        ? body.data.source!.trim()
        : "Permintaan opt-out dicatat di ShareWa",
    });
    await tx.insert(activityTable).values({
      ownerUserId: userId,
      kind: "consent_updated",
      summary: body.data.status === "opted_in"
        ? `Izin ${updated.displayName} dicatat kembali.`
        : `Permintaan opt-out ${updated.displayName} dicatat.`,
    });
    return [updated];
  });
  if (!contact) {
    res.status(404).json({ error: "Kontak tidak ditemukan." });
    return;
  }
  res.json(UpdateContactConsentResponse.parse(contact));
});

export default router;
