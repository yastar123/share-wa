import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
  uuid,
} from "drizzle-orm/pg-core";

export const consentStatusEnum = pgEnum("sharewa_consent_status", [
  "opted_in",
  "opted_out",
  "pending",
]);

export const connectionStatusEnum = pgEnum("sharewa_connection_status", [
  "disconnected",
  "awaiting_link",
  "connected",
  "reconnecting",
  "error",
]);

export const messageStatusEnum = pgEnum("sharewa_message_status", [
  "queued",
  "sent",
  "delivered",
  "failed",
]);

export const accountStatusEnum = pgEnum("sharewa_account_status", [
  "active",
  "suspended",
  "deletion_pending",
]);

export const userProfilesTable = pgTable("sharewa_user_profiles", {
  userId: text("user_id").primaryKey(),
  email: text("email").unique(),
  fullName: text("full_name").notNull().default("Pengguna baru"),
  username: text("username").notNull().unique(),
  referralCode: varchar("referral_code", { length: 16 }).unique(),
  referredByUserId: text("referred_by_user_id"),
  preferredCurrency: text("preferred_currency").notNull().default("IDR"),
  termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }),
  passwordHash: text("password_hash"),
  telegramUsername: text("telegram_username"),
  language: text("language").notNull().default("id"),
  accountStatus: accountStatusEnum("account_status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const contactsTable = pgTable(
  "sharewa_contacts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => userProfilesTable.userId, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    phone: text("phone").notNull(),
    consentStatus: consentStatusEnum("consent_status").notNull().default("opted_in"),
    consentSource: text("consent_source").notNull(),
    consentedAt: timestamp("consented_at", { withTimezone: true }),
    optedOutAt: timestamp("opted_out_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("sharewa_contacts_owner_phone_unique").on(table.ownerUserId, table.phone),
    index("sharewa_contacts_owner_consent_idx").on(table.ownerUserId, table.consentStatus),
  ],
);

export const consentEventsTable = pgTable(
  "sharewa_consent_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => userProfilesTable.userId, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contactsTable.id, { onDelete: "cascade" }),
    status: consentStatusEnum("status").notNull(),
    source: text("source").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("sharewa_consent_events_contact_idx").on(table.contactId, table.createdAt)],
);

export const whatsappSessionsTable = pgTable("sharewa_whatsapp_sessions", {
  ownerUserId: text("owner_user_id")
    .primaryKey()
    .references(() => userProfilesTable.userId, { onDelete: "cascade" }),
  encryptedCredentials: text("encrypted_credentials"),
  encryptedSignalKeys: text("encrypted_signal_keys"),
  status: connectionStatusEnum("status").notNull().default("disconnected"),
  linkedPhone: text("linked_phone"),
  pairingCode: text("pairing_code"),
  pairingExpiresAt: timestamp("pairing_expires_at", { withTimezone: true }),
  lastError: text("last_error"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const messagesTable = pgTable(
  "sharewa_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => userProfilesTable.userId, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contactsTable.id, { onDelete: "cascade" }),
    contactName: text("contact_name").notNull(),
    phone: text("phone").notNull(),
    text: text("text").notNull(),
    status: messageStatusEnum("status").notNull().default("queued"),
    whatsappMessageId: text("whatsapp_message_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("sharewa_messages_owner_created_idx").on(table.ownerUserId, table.createdAt),
    index("sharewa_messages_contact_created_idx").on(table.contactId, table.createdAt),
  ],
);

export const activityTable = pgTable(
  "sharewa_activity",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => userProfilesTable.userId, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    summary: text("summary").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("sharewa_activity_owner_created_idx").on(table.ownerUserId, table.createdAt)],
);

export const authSessionsTable = pgTable(
  "sharewa_auth_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => userProfilesTable.userId, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("sharewa_auth_sessions_expiry_idx").on(table.expiresAt)],
);

export const passwordResetTokensTable = pgTable(
  "sharewa_password_reset_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => userProfilesTable.userId, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("sharewa_password_reset_expiry_idx").on(table.expiresAt)],
);

export const notificationsTable = pgTable(
  "sharewa_notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => userProfilesTable.userId, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("sharewa_notifications_owner_created_idx").on(table.ownerUserId, table.createdAt),
    index("sharewa_notifications_owner_read_idx").on(table.ownerUserId, table.readAt),
  ],
);

export const payoutPreferencesTable = pgTable("sharewa_payout_preferences", {
  ownerUserId: text("owner_user_id")
    .primaryKey()
    .references(() => userProfilesTable.userId, { onDelete: "cascade" }),
  method: text("method").notNull(),
  institution: text("institution").notNull(),
  accountNumber: text("account_number").notNull(),
  accountHolder: text("account_holder").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const walletLedgerTable = pgTable(
  "sharewa_wallet_ledger",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => userProfilesTable.userId, { onDelete: "cascade" }),
    amount: integer("amount").notNull(),
    currency: text("currency").notNull(),
    kind: text("kind").notNull(),
    sourceUserId: text("source_user_id").references(() => userProfilesTable.userId, {
      onDelete: "set null",
    }),
    messageId: uuid("message_id").references(() => messagesTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("sharewa_wallet_ledger_message_kind_unique").on(table.messageId, table.kind),
    index("sharewa_wallet_ledger_owner_created_idx").on(table.ownerUserId, table.createdAt),
  ],
);

export const withdrawalsTable = pgTable(
  "sharewa_withdrawals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => userProfilesTable.userId, { onDelete: "cascade" }),
    amount: integer("amount").notNull(),
    currency: text("currency").notNull(),
    status: text("status").notNull().default("pending"),
    payoutMethod: text("payout_method").notNull(),
    payoutInstitution: text("payout_institution").notNull(),
    payoutAccountNumber: text("payout_account_number").notNull(),
    payoutAccountHolder: text("payout_account_holder").notNull(),
    adminNote: text("admin_note"),
    processedByUserId: text("processed_by_user_id").references(
      () => userProfilesTable.userId,
      { onDelete: "set null" },
    ),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("sharewa_withdrawals_owner_created_idx").on(table.ownerUserId, table.createdAt),
    index("sharewa_withdrawals_status_created_idx").on(table.status, table.createdAt),
  ],
);

export const insertContactSchema = createInsertSchema(contactsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertContact = z.infer<typeof insertContactSchema>;
export type Contact = typeof contactsTable.$inferSelect;
export type Message = typeof messagesTable.$inferSelect;
