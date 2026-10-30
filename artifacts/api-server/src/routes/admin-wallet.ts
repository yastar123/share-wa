import { and, desc, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  db,
  userProfilesTable,
  withdrawalsTable,
} from "@workspace/db";
import { requireAdmin } from "../middlewares/requireAdmin";
import { requireAuth } from "../middlewares/requireAuth";
import { decryptPayoutField } from "../lib/payout-crypto";
import { createNotification } from "../lib/notifications";

const router: IRouter = Router();
router.use("/admin", requireAuth, requireAdmin);

router.get("/admin/withdrawals", async (req, res): Promise<void> => {
  const status = typeof req.query.status === "string" ? req.query.status : "pending";
  if (!["all", "pending", "paid", "rejected", "cancelled"].includes(status)) {
    res.status(400).json({ error: "Filter status penarikan tidak valid." });
    return;
  }
  const filters = status === "all" ? [] : [eq(withdrawalsTable.status, status)];
  const requests = await db.select({
    id: withdrawalsTable.id,
    ownerUserId: withdrawalsTable.ownerUserId,
    ownerUsername: userProfilesTable.username,
    amount: withdrawalsTable.amount,
    currency: withdrawalsTable.currency,
    status: withdrawalsTable.status,
    payoutMethod: withdrawalsTable.payoutMethod,
    payoutInstitution: withdrawalsTable.payoutInstitution,
    payoutAccountNumber: withdrawalsTable.payoutAccountNumber,
    payoutAccountHolder: withdrawalsTable.payoutAccountHolder,
    adminNote: withdrawalsTable.adminNote,
    createdAt: withdrawalsTable.createdAt,
    processedAt: withdrawalsTable.processedAt,
  }).from(withdrawalsTable)
    .innerJoin(userProfilesTable, eq(withdrawalsTable.ownerUserId, userProfilesTable.userId))
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(withdrawalsTable.createdAt))
    .limit(200);
  res.json(requests.map((request) => ({
    ...request,
    payoutAccountNumber: decryptPayoutField(request.payoutAccountNumber),
    payoutAccountHolder: decryptPayoutField(request.payoutAccountHolder),
  })));
});

router.patch("/admin/withdrawals", async (req, res): Promise<void> => {
  const { withdrawalId, status, adminNote } = req.body ?? {};
  if (
    typeof withdrawalId !== "string" ||
    !["paid", "rejected"].includes(status) ||
    (adminNote !== undefined && (typeof adminNote !== "string" || adminNote.length > 500))
  ) {
    res.status(400).json({ error: "Data keputusan penarikan tidak valid." });
    return;
  }
  const [existing] = await db.select().from(withdrawalsTable)
    .where(eq(withdrawalsTable.id, withdrawalId))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "Permintaan penarikan tidak ditemukan." });
    return;
  }
  if (existing.status !== "pending") {
    res.status(409).json({ error: "Permintaan penarikan sudah diproses." });
    return;
  }
  const processedAt = new Date();
  const [updated] = await db.update(withdrawalsTable).set({
    status,
    adminNote: typeof adminNote === "string" ? adminNote.trim() || null : null,
    processedByUserId: res.locals.userId as string,
    processedAt,
  }).where(and(
    eq(withdrawalsTable.id, withdrawalId),
    eq(withdrawalsTable.status, "pending"),
  )).returning();
  if (!updated) {
    res.status(409).json({ error: "Permintaan penarikan sudah diproses oleh admin lain." });
    return;
  }
  const [owner] = await db.select({ ownerUsername: userProfilesTable.username })
    .from(userProfilesTable)
    .where(eq(userProfilesTable.userId, updated.ownerUserId))
    .limit(1);
  if (!owner) throw new Error("Withdrawal owner profile disappeared during admin processing.");
  await createNotification({
    ownerUserId: updated.ownerUserId,
    kind: `withdrawal_${status}`,
    title: status === "paid" ? "Penarikan telah dibayar" : "Permintaan penarikan ditolak",
    body: typeof adminNote === "string" && adminNote.trim()
      ? adminNote.trim()
      : status === "paid"
        ? "Admin telah menandai transfer penarikan Anda sebagai selesai."
        : "Admin telah menolak permintaan penarikan Anda.",
  });
  res.json({
    ...updated,
    ownerUsername: owner.ownerUsername,
    payoutAccountNumber: decryptPayoutField(updated.payoutAccountNumber),
    payoutAccountHolder: decryptPayoutField(updated.payoutAccountHolder),
  });
});

export default router;
