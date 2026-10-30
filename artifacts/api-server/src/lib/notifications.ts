import { notificationsTable, db } from "@workspace/db";
import { logger } from "./logger";

export async function createNotification(input: {
  ownerUserId: string;
  kind: string;
  title: string;
  body: string;
}): Promise<void> {
  try {
    await db.insert(notificationsTable).values(input);
  } catch (error) {
    logger.error({ err: error, ownerUserId: input.ownerUserId, kind: input.kind }, "Failed to save user notification");
  }
}
