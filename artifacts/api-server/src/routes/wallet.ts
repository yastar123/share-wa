import { and, eq, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import {
  db,
  messagesTable,
  payoutPreferencesTable,
  userProfilesTable,
  walletLedgerTable,
  withdrawalsTable,
} from "@workspace/db";
import {
  ensureReferralCode,
  getCurrencySettings,
  getWalletOverview,
  type CurrencyCode,
} from "../lib/wallet";
import { decryptPayoutField, encryptPayoutField } from "../lib/payout-crypto";
import { requireAuth } from "../middlewares/requireAuth";
import { createNotification } from "../lib/notifications";

const router: IRouter = Router();
router.use(requireAuth);

router.get("/wallet", async (_req, res): Promise<void> => {
  const overview = await getWalletOverview(res.locals.userId as string);
  res.json(overview);
});

router.get("/payout-preferences", async (_req, res): Promise<void> => {
  const [preferences] = await db.select().from(payoutPreferencesTable)
    .where(eq(payoutPreferencesTable.ownerUserId, res.locals.userId as string))
    .limit(1);
  res.json({
    method: preferences?.method ?? null,
    institution: preferences?.institution ?? null,
    accountNumber: preferences ? decryptPayoutField(preferences.accountNumber) : null,
    accountHolder: preferences ? decryptPayoutField(preferences.accountHolder) : null,
  });
});

router.put("/payout-preferences", async (req, res): Promise<void> => {
  const { method, institution, accountNumber, accountHolder } = req.body ?? {};
  if (
    !["bank", "e_wallet"].includes(method) ||
    typeof institution !== "string" || institution.trim().length < 2 || institution.length > 80 ||
    typeof accountNumber !== "string" || accountNumber.trim().length < 4 || accountNumber.length > 40 ||
    typeof accountHolder !== "string" || accountHolder.trim().length < 2 || accountHolder.length > 120
  ) {
    res.status(400).json({ error: "Lengkapi tujuan pencairan dengan data yang valid." });
    return;
  }
  const userId = res.locals.userId as string;
  const values = {
    ownerUserId: userId,
    method,
    institution: institution.trim(),
    accountNumber: encryptPayoutField(accountNumber.trim()),
    accountHolder: encryptPayoutField(accountHolder.trim()),
    updatedAt: new Date(),
  };
  const [existing] = await db.select({ ownerUserId: payoutPreferencesTable.ownerUserId })
    .from(payoutPreferencesTable)
    .where(eq(payoutPreferencesTable.ownerUserId, userId))
    .limit(1);
  if (existing) {
    await db.update(payoutPreferencesTable).set(values)
      .where(eq(payoutPreferencesTable.ownerUserId, userId));
  } else {
    await db.insert(payoutPreferencesTable).values(values);
  }
  res.json({
    method: values.method,
    institution: values.institution,
    accountNumber: decryptPayoutField(values.accountNumber),
    accountHolder: decryptPayoutField(values.accountHolder),
  });
});

router.post("/withdrawals", async (req, res): Promise<void> => {
  const { amount, currency } = req.body ?? {};
  if (
    !Number.isSafeInteger(amount) || amount <= 0 ||
    !["IDR", "USD", "CNY"].includes(currency)
  ) {
    res.status(400).json({ error: "Nominal atau mata uang penarikan tidak valid." });
    return;
  }
  const userId = res.locals.userId as string;
  const settings = await getCurrencySettings();
  const currencyCode = currency as CurrencyCode;
  const currencySetting = settings[currencyCode];
  if (!currencySetting.enabled) {
    res.status(409).json({ error: "Mata uang ini sedang tidak tersedia." });
    return;
  }
  if (amount < currencySetting.minimumWithdrawal) {
    res.status(409).json({ error: "Nominal belum mencapai batas minimum penarikan." });
    return;
  }

  const created = await db.transaction(async (tx) => {
    await tx.execute(sql`
      select pg_advisory_xact_lock(hashtextextended(${userId}, 1))
    `);
    const [destination] = await tx.select().from(payoutPreferencesTable)
      .where(eq(payoutPreferencesTable.ownerUserId, userId))
      .limit(1);
    if (!destination) return { error: "destination" as const };

    const ledger = await tx.select().from(walletLedgerTable)
      .where(and(
        eq(walletLedgerTable.ownerUserId, userId),
        eq(walletLedgerTable.currency, currencyCode),
      ));
    const existingWithdrawals = await tx.select().from(withdrawalsTable)
      .where(and(
        eq(withdrawalsTable.ownerUserId, userId),
        eq(withdrawalsTable.currency, currencyCode),
      ));
    const balance = ledger.reduce((sum, entry) => sum + entry.amount, 0)
      - existingWithdrawals
        .filter((request) => request.status === "pending" || request.status === "paid")
        .reduce((sum, request) => sum + request.amount, 0);
    if (amount > balance) return { error: "balance" as const };

    const [withdrawal] = await tx.insert(withdrawalsTable).values({
      ownerUserId: userId,
      amount,
      currency: currencyCode,
      payoutMethod: destination.method,
      payoutInstitution: destination.institution,
      payoutAccountNumber: destination.accountNumber,
      payoutAccountHolder: destination.accountHolder,
    }).returning();
    if (!withdrawal) throw new Error("Withdrawal request could not be saved.");
    return { withdrawal };
  });

  if ("error" in created) {
    res.status(409).json({
      error: created.error === "destination"
        ? "Simpan tujuan pencairan sebelum mengajukan penarikan."
        : "Saldo tersedia tidak mencukupi.",
    });
    return;
  }
  await createNotification({
    ownerUserId: userId,
    kind: "withdrawal_pending",
    title: "Permintaan penarikan diterima",
    body: `Permintaan ${amount} ${currencyCode} menunggu peninjauan admin.`,
  });
  res.status(201).json(created.withdrawal);
});

router.delete("/withdrawals/:withdrawalId", async (req, res): Promise<void> => {
  const parsedId = z.string().uuid().safeParse(req.params.withdrawalId);
  if (!parsedId.success) {
    res.status(400).json({ error: "ID penarikan tidak valid." });
    return;
  }
  const withdrawalId = parsedId.data;
  const userId = res.locals.userId as string;
  const [existing] = await db.select()
    .from(withdrawalsTable)
    .where(and(
      eq(withdrawalsTable.id, withdrawalId),
      eq(withdrawalsTable.ownerUserId, userId),
    ))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "Permintaan penarikan tidak ditemukan." });
    return;
  }
  if (existing.status !== "pending") {
    res.status(409).json({ error: "Hanya permintaan yang masih menunggu yang dapat dibatalkan." });
    return;
  }

  const [cancelled] = await db.update(withdrawalsTable)
    .set({ status: "cancelled", processedAt: new Date() })
    .where(and(
      eq(withdrawalsTable.id, withdrawalId),
      eq(withdrawalsTable.ownerUserId, userId),
      eq(withdrawalsTable.status, "pending"),
    ))
    .returning();
  if (!cancelled) {
    res.status(409).json({ error: "Permintaan penarikan sedang diproses dan tidak dapat dibatalkan." });
    return;
  }
  await createNotification({
    ownerUserId: userId,
    kind: "withdrawal_cancelled",
    title: "Permintaan penarikan dibatalkan",
    body: "Permintaan penarikan tertunda berhasil dibatalkan.",
  });
  res.json(cancelled);
});

router.get("/referrals", async (req, res): Promise<void> => {
  const userId = res.locals.userId as string;
  const referralCode = await ensureReferralCode(userId);
  const members = await db.select({
    userId: userProfilesTable.userId,
    username: userProfilesTable.username,
    joinedAt: userProfilesTable.createdAt,
  }).from(userProfilesTable)
    .where(eq(userProfilesTable.referredByUserId, userId));
  const memberResults = await Promise.all(members.map(async (member) => {
    const sent = await db.select({ id: messagesTable.id }).from(messagesTable)
      .where(and(
        eq(messagesTable.ownerUserId, member.userId),
        eq(messagesTable.status, "sent"),
      ));
    return {
      username: member.username,
      joinedAt: member.joinedAt,
      sentMessages: sent.length,
    };
  }));
  const baseUrl = process.env.PUBLIC_APP_URL?.replace(/\/$/, "");
  const referralPath = `/sign-up?ref=${encodeURIComponent(referralCode)}`;
  res.json({
    referralCode,
    referralLink: baseUrl ? `${baseUrl}${referralPath}` : referralPath,
    members: memberResults,
  });
});

export default router;
