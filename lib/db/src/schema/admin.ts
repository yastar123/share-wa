import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { boolean, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { userProfilesTable } from "./sharewa";

export const adminUsersTable = pgTable("sharewa_admin_users", {
  userId: text("user_id")
    .primaryKey()
    .references(() => userProfilesTable.userId, { onDelete: "cascade" }),
  grantedByUserId: text("granted_by_user_id").references(
    () => userProfilesTable.userId,
    { onDelete: "set null" },
  ),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const systemSettingsTable = pgTable("sharewa_system_settings", {
  id: integer("id").primaryKey(),
  outboundMessagingEnabled: boolean("outbound_messaging_enabled")
    .notNull()
    .default(true),
  outboundMessageLimits: jsonb("outbound_message_limits")
    .$type<{
      maxBatchSize: number;
      maxMessagesPerHour: number;
      delayBetweenMessagesMs: number;
    }>()
    .notNull()
    .default({
      maxBatchSize: 5,
      maxMessagesPerHour: 20,
      delayBetweenMessagesMs: 3000,
    }),
  currencySettings: jsonb("currency_settings")
    .$type<Record<string, {
      enabled: boolean;
      minimumWithdrawal: number;
      earningPerMessage: number;
      commissionPerMessage: number;
    }>>()
    .notNull()
    .default({
      IDR: { enabled: true, minimumWithdrawal: 100_000, earningPerMessage: 50, commissionPerMessage: 50 },
      USD: { enabled: true, minimumWithdrawal: 1_000, earningPerMessage: 50, commissionPerMessage: 50 },
      CNY: { enabled: true, minimumWithdrawal: 7_000, earningPerMessage: 350, commissionPerMessage: 350 },
    }),
  updatedByUserId: text("updated_by_user_id").references(
    () => userProfilesTable.userId,
    { onDelete: "set null" },
  ),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertAdminUserSchema = createInsertSchema(adminUsersTable).omit({
  createdAt: true,
});
export type InsertAdminUser = z.infer<typeof insertAdminUserSchema>;
export type AdminUserRole = typeof adminUsersTable.$inferSelect;
