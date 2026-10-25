import { Router, type IRouter } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  GetDashboardActivityQueryParams,
  GetDashboardActivityResponse,
  GetDashboardSummaryResponse,
} from "@workspace/api-zod";
import {
  activityTable,
  contactsTable,
  db,
  messagesTable,
} from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { getWhatsAppStatus } from "../lib/whatsapp";

const router: IRouter = Router();
router.use(requireAuth);

async function countWhere<T extends typeof contactsTable | typeof messagesTable>(
  table: T,
  filters: Parameters<typeof and>[number][],
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(table)
    .where(and(...filters));
  return Number(row?.count ?? 0);
}

router.get("/dashboard/summary", async (_req, res): Promise<void> => {
  const userId = res.locals.userId as string;
  const [connection, totalContacts, optedInContacts, optedOutContacts, messagesSent, messagesDelivered, messagesFailed] =
    await Promise.all([
      getWhatsAppStatus(userId),
      countWhere(contactsTable, [eq(contactsTable.ownerUserId, userId)]),
      countWhere(contactsTable, [
        eq(contactsTable.ownerUserId, userId),
        eq(contactsTable.consentStatus, "opted_in"),
      ]),
      countWhere(contactsTable, [
        eq(contactsTable.ownerUserId, userId),
        eq(contactsTable.consentStatus, "opted_out"),
      ]),
      countWhere(messagesTable, [
        eq(messagesTable.ownerUserId, userId),
        eq(messagesTable.status, "sent"),
      ]),
      countWhere(messagesTable, [
        eq(messagesTable.ownerUserId, userId),
        eq(messagesTable.status, "delivered"),
      ]),
      countWhere(messagesTable, [
        eq(messagesTable.ownerUserId, userId),
        eq(messagesTable.status, "failed"),
      ]),
    ]);

  res.json(
    GetDashboardSummaryResponse.parse({
      connectionStatus: connection.status,
      linkedPhone: connection.linkedPhone,
      totalContacts,
      optedInContacts,
      optedOutContacts,
      messagesSent,
      messagesDelivered,
      messagesFailed,
    }),
  );
});

router.get("/dashboard/activity", async (req, res): Promise<void> => {
  const parsed = GetDashboardActivityQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const userId = res.locals.userId as string;
  const rows = await db
    .select()
    .from(activityTable)
    .where(eq(activityTable.ownerUserId, userId))
    .orderBy(desc(activityTable.createdAt))
    .limit(parsed.data.limit);

  res.json(GetDashboardActivityResponse.parse(rows));
});

export default router;
