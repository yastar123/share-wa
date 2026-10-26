import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { userProfilesTable } from "./sharewa";

export const adminUsersTable = pgTable("sharewa_admin_users", {
  clerkUserId: text("clerk_user_id")
    .primaryKey()
    .references(() => userProfilesTable.clerkUserId, { onDelete: "cascade" }),
  grantedByUserId: text("granted_by_user_id").references(
    () => userProfilesTable.clerkUserId,
    { onDelete: "set null" },
  ),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertAdminUserSchema = createInsertSchema(adminUsersTable).omit({
  createdAt: true,
});
export type InsertAdminUser = z.infer<typeof insertAdminUserSchema>;
export type AdminUserRole = typeof adminUsersTable.$inferSelect;
