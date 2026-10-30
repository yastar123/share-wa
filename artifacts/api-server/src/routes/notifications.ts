import { and, desc, eq, isNull } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { db, notificationsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();
router.use(requireAuth);
const notificationFields = {
  id: notificationsTable.id,
  kind: notificationsTable.kind,
  title: notificationsTable.title,
  body: notificationsTable.body,
  readAt: notificationsTable.readAt,
  createdAt: notificationsTable.createdAt,
};

router.get("/notifications", async (req, res): Promise<void> => {
  const parsedLimit = z.coerce.number().int().min(1).max(50).default(20).safeParse(req.query.limit);
  if (!parsedLimit.success) {
    res.status(400).json({ error: "Batas notifikasi tidak valid." });
    return;
  }
  const ownerUserId = res.locals.userId as string;
  const rows = await db.select(notificationFields).from(notificationsTable)
    .where(eq(notificationsTable.ownerUserId, ownerUserId))
    .orderBy(desc(notificationsTable.createdAt))
    .limit(parsedLimit.data);
  res.json(rows);
});

router.patch("/notifications/:notificationId/read", async (req, res): Promise<void> => {
  const parsedId = z.string().uuid().safeParse(req.params.notificationId);
  if (!parsedId.success) {
    res.status(400).json({ error: "ID notifikasi tidak valid." });
    return;
  }
  const [updated] = await db.update(notificationsTable)
    .set({ readAt: new Date() })
    .where(and(
      eq(notificationsTable.id, parsedId.data),
      eq(notificationsTable.ownerUserId, res.locals.userId as string),
      isNull(notificationsTable.readAt),
    ))
    .returning(notificationFields);
  if (!updated) {
    const [existing] = await db.select(notificationFields).from(notificationsTable)
      .where(and(
        eq(notificationsTable.id, parsedId.data),
        eq(notificationsTable.ownerUserId, res.locals.userId as string),
      ))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "Notifikasi tidak ditemukan." });
      return;
    }
    res.json(existing);
    return;
  }
  res.json(updated);
});

router.post("/notifications/read-all", async (_req, res): Promise<void> => {
  await db.update(notificationsTable)
    .set({ readAt: new Date() })
    .where(and(
      eq(notificationsTable.ownerUserId, res.locals.userId as string),
      isNull(notificationsTable.readAt),
    ));
  res.json({ updated: true });
});

export default router;
