import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  db,
  messagesTable,
  payoutPreferencesTable,
  systemSettingsTable,
  userProfilesTable,
  walletLedgerTable,
  withdrawalsTable,
} from "@workspace/db";
import { decryptPayoutField } from "./payout-crypto";

export const DEFAULT_CURRENCY_SETTINGS = {
  IDR: { enabled: true, minimumWithdrawal: 100_000, earningPerMessage: 50, commissionPerMessage: 50 },
  USD: { enabled: true, minimumWithdrawal: 1_000, earningPerMessage: 50, commissionPerMessage: 50 },
  CNY: { enabled: true, minimumWithdrawal: 7_000, earningPerMessage: 350, commissionPerMessage: 350 },
} as const;

export type CurrencyCode = keyof typeof DEFAULT_CURRENCY_SETTINGS;
export type CurrencySetting = {
  enabled: boolean;
  minimumWithdrawal: number;
  earningPerMessage: number;
  commissionPerMessage: number;
};
export type CurrencySettings = Record<CurrencyCode, CurrencySetting>;

function isDuplicateMessageAward(error: unknown): boolean {
  return error !== null && typeof error === "object"
    && "code" in error && error.code === "23505"
    && "constraint" in error
    && error.constraint === "sharewa_wallet_ledger_message_kind_unique";
}

export async function getCurrencySettings(): Promise<CurrencySettings> {
  const [settings] = await db
    .select({ currencySettings: systemSettingsTable.currencySettings })
    .from(systemSettingsTable)
    .where(eq(systemSettingsTable.id, 1))
    .limit(1);
  const configured = settings?.currencySettings ?? {};
  return Object.fromEntries(
    (Object.keys(DEFAULT_CURRENCY_SETTINGS) as CurrencyCode[]).map((currency) => {
      const value = configured[currency];
      return [currency, {
        enabled: value?.enabled ?? DEFAULT_CURRENCY_SETTINGS[currency].enabled,
        minimumWithdrawal: value?.minimumWithdrawal
          ?? DEFAULT_CURRENCY_SETTINGS[currency].minimumWithdrawal,
        earningPerMessage: value?.earningPerMessage
          ?? DEFAULT_CURRENCY_SETTINGS[currency].earningPerMessage,
        commissionPerMessage: value?.commissionPerMessage
          ?? DEFAULT_CURRENCY_SETTINGS[currency].commissionPerMessage,
      }];
    }),
  ) as CurrencySettings;
}

export async function ensureReferralCode(userId: string): Promise<string> {
  const [profile] = await db
    .select({
      referralCode: userProfilesTable.referralCode,
      username: userProfilesTable.username,
    })
    .from(userProfilesTable)
    .where(eq(userProfilesTable.userId, userId))
    .limit(1);
  if (!profile) throw new Error("Cannot create referral code for a missing profile.");
  if (profile.referralCode) return profile.referralCode;

  const code = randomBytes(5).toString("hex").toUpperCase();
  const [updated] = await db
    .update(userProfilesTable)
    .set({ referralCode: code })
    .where(eq(userProfilesTable.userId, userId))
    .returning({ referralCode: userProfilesTable.referralCode });
  if (!updated?.referralCode) throw new Error("Referral code could not be saved.");
  return updated.referralCode;
}

export async function awardReferralCommission(
  referredUserId: string,
  messageId: string,
): Promise<void> {
  const [profile] = await db
    .select({
      referredByUserId: userProfilesTable.referredByUserId,
      currency: userProfilesTable.preferredCurrency,
    })
    .from(userProfilesTable)
    .where(eq(userProfilesTable.userId, referredUserId))
    .limit(1);
  if (!profile?.referredByUserId) return;

  const currency = profile.currency as CurrencyCode;
  const [referrer] = await db
    .select({ preferredCurrency: userProfilesTable.preferredCurrency })
    .from(userProfilesTable)
    .where(eq(userProfilesTable.userId, profile.referredByUserId))
    .limit(1);
  if (!referrer) return;
  const referrerCurrency = referrer.preferredCurrency as CurrencyCode;
  const setting = (await getCurrencySettings())[referrerCurrency];
  if (!setting?.enabled || setting.commissionPerMessage <= 0) return;

  const [existing] = await db
    .select({ id: walletLedgerTable.id })
    .from(walletLedgerTable)
    .where(and(
      eq(walletLedgerTable.messageId, messageId),
      eq(walletLedgerTable.kind, "referral_message"),
    ))
    .limit(1);
  if (existing) return;

  try {
    await db.insert(walletLedgerTable).values({
      ownerUserId: profile.referredByUserId,
      sourceUserId: referredUserId,
      messageId,
      amount: setting.commissionPerMessage,
      currency: referrerCurrency,
      kind: "referral_message",
    });
  } catch (error) {
    if (isDuplicateMessageAward(error)) return;
    throw error;
  }
}

export async function awardMessageEarnings(
  ownerUserId: string,
  messageId: string,
): Promise<void> {
  const [profile] = await db.select({
    currency: userProfilesTable.preferredCurrency,
  }).from(userProfilesTable)
    .where(eq(userProfilesTable.userId, ownerUserId))
    .limit(1);
  if (!profile) throw new Error("Cannot award message earnings for a missing profile.");
  const currency = profile.currency as CurrencyCode;
  const setting = (await getCurrencySettings())[currency];
  if (!setting.enabled || setting.earningPerMessage <= 0) return;
  const [existing] = await db.select({ id: walletLedgerTable.id })
    .from(walletLedgerTable)
    .where(and(
      eq(walletLedgerTable.messageId, messageId),
      eq(walletLedgerTable.kind, "message_earning"),
    ))
    .limit(1);
  if (existing) return;
  try {
    await db.insert(walletLedgerTable).values({
      ownerUserId,
      sourceUserId: null,
      messageId,
      amount: setting.earningPerMessage,
      currency,
      kind: "message_earning",
    });
  } catch (error) {
    if (isDuplicateMessageAward(error)) return;
    throw error;
  }
}

export async function getWalletOverview(userId: string) {
  const [profile, payout, ledger, withdrawals, referredProfiles] = await Promise.all([
    db
      .select({
        preferredCurrency: userProfilesTable.preferredCurrency,
        referralCode: userProfilesTable.referralCode,
      })
      .from(userProfilesTable)
      .where(eq(userProfilesTable.userId, userId))
      .limit(1),
    db
      .select()
      .from(payoutPreferencesTable)
      .where(eq(payoutPreferencesTable.ownerUserId, userId))
      .limit(1),
    db.select().from(walletLedgerTable)
      .where(eq(walletLedgerTable.ownerUserId, userId)),
    db.select().from(withdrawalsTable)
      .where(eq(withdrawalsTable.ownerUserId, userId)),
    db.select({ userId: userProfilesTable.userId })
      .from(userProfilesTable)
      .where(eq(userProfilesTable.referredByUserId, userId)),
  ]);
  if (!profile[0]) throw new Error("Cannot load wallet for a missing profile.");

  const currency = profile[0].preferredCurrency as CurrencyCode;
  const settings = await getCurrencySettings();
  const currencyLedger = ledger.filter((entry) => entry.currency === currency);
  const currencyWithdrawals = withdrawals.filter(
    (request) => request.currency === currency && ["pending", "paid"].includes(request.status),
  );
  const totalEarned = currencyLedger.reduce((sum, entry) => sum + entry.amount, 0);
  const totalWithdrawn = currencyWithdrawals
    .filter((request) => request.status === "paid")
    .reduce((sum, request) => sum + request.amount, 0);
  const reserved = currencyWithdrawals
    .filter((request) => request.status === "pending")
    .reduce((sum, request) => sum + request.amount, 0);
  const referralMessages = referredProfiles.length
    ? await Promise.all(referredProfiles.map(async (referred) => {
      const sent = await db.select({ id: messagesTable.id })
        .from(messagesTable)
        .where(and(
          eq(messagesTable.ownerUserId, referred.userId),
          eq(messagesTable.status, "sent"),
        ));
      return sent.length;
    }))
    : [];
  const referralEarnings = ledger
    .filter((entry) => entry.kind === "referral_message" && entry.currency === currency)
    .reduce((sum, entry) => sum + entry.amount, 0);
  const referralCode = await ensureReferralCode(userId);

  return {
    currency,
    availableBalance: totalEarned - totalWithdrawn - reserved,
    totalEarned,
    totalWithdrawn,
    minimumWithdrawal: settings[currency].minimumWithdrawal,
    earningPerMessage: settings[currency].earningPerMessage,
    commissionPerMessage: settings[currency].commissionPerMessage,
    withdrawals: withdrawals.map((request) => ({
      ...request,
      payoutAccountNumber: decryptPayoutField(request.payoutAccountNumber),
      payoutAccountHolder: decryptPayoutField(request.payoutAccountHolder),
    })),
    referralCode,
    referralCount: referredProfiles.length,
    referralMessages: referralMessages.reduce((sum, count) => sum + count, 0),
    referralEarnings,
    payoutConfigured: !!payout[0],
  };
}
