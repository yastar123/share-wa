import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { boolean, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
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
