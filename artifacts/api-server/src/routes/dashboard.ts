import { Router, type IRouter } from "express";
import { and, desc, eq, gte, sql } from "drizzle-orm";
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

async function countContacts(userId: string, consentStatus?: "opted_in" | "opted_out"): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(contactsTable)
    .where(consentStatus
      ? and(
          eq(contactsTable.ownerUserId, userId),
          eq(contactsTable.consentStatus, consentStatus),
        )
      : eq(contactsTable.ownerUserId, userId));
  return Number(row?.count ?? 0);
}

async function countMessages(userId: string, status: "queued" | "sent" | "delivered" | "failed", since?: Date): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(messagesTable)
    .where(and(
      eq(messagesTable.ownerUserId, userId),
      eq(messagesTable.status, status),
      ...(since ? [gte(messagesTable.createdAt, since)] : []),
    ));
  return Number(row?.count ?? 0);
}

router.get("/dashboard/summary", async (_req, res): Promise<void> => {
  const userId = res.locals.userId as string;
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [
    connection,
    totalContacts,
    optedInContacts,
    optedOutContacts,
    messagesQueued,
    messagesSent,
    messagesDelivered,
    messagesFailed,
    messagesDeliveredLast7Days,
    messagesFailedLast7Days,
  ] =
    await Promise.all([
      getWhatsAppStatus(userId),
      countContacts(userId),
      countContacts(userId, "opted_in"),
      countContacts(userId, "opted_out"),
      countMessages(userId, "queued"),
      countMessages(userId, "sent"),
      countMessages(userId, "delivered"),
      countMessages(userId, "failed"),
      countMessages(userId, "delivered", sevenDaysAgo),
      countMessages(userId, "failed", sevenDaysAgo),
    ]);

  res.json(
    GetDashboardSummaryResponse.parse({
      connectionStatus: connection.status,
      linkedPhone: connection.linkedPhone,
      totalContacts,
      optedInContacts,
      optedOutContacts,
      messagesQueued,
      messagesSent,
      messagesDelivered,
      messagesFailed,
      messagesDeliveredLast7Days,
      messagesFailedLast7Days,
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
