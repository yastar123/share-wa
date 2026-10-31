import { and, eq, gte, sql } from "drizzle-orm";
import { db, messagesTable, type Message } from "@workspace/db";
import {
  DEFAULT_OUTBOUND_MESSAGE_LIMITS,
  type OutboundMessageLimits,
} from "./system-settings";

const accountLocks = new Map<string, Promise<void>>();

async function withAccountLock<T>(key: string, action: () => Promise<T>): Promise<T> {
  const previous = accountLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  accountLocks.set(key, current);
  await previous;
  try {
    return await action();
  } finally {
    release();
    if (accountLocks.get(key) === current) accountLocks.delete(key);
  }
}

export async function reserveOutboundMessage(input: {
  ownerUserId: string;
  contactId: string;
  contactName: string;
  phone: string;
  text: string;
  maxMessagesPerHour?: number;
}): Promise<Message | null> {
  return withAccountLock(input.ownerUserId, () => db.transaction(async (tx) => {
    await tx.execute(sql`
      select pg_advisory_xact_lock(hashtextextended(${input.ownerUserId}, 0))
    `);

    const cutoff = new Date(Date.now() - 60 * 60 * 1000);
    const recentMessages = await tx
      .select({ id: messagesTable.id })
      .from(messagesTable)
      .where(and(
        eq(messagesTable.ownerUserId, input.ownerUserId),
        gte(messagesTable.createdAt, cutoff),
      ));
    const remaining = Math.max(
      (input.maxMessagesPerHour ?? DEFAULT_OUTBOUND_MESSAGE_LIMITS.maxMessagesPerHour) - recentMessages.length,
      0,
    );
    if (remaining === 0) return null;

    const [message] = await tx
      .insert(messagesTable)
      .values({
        ownerUserId: input.ownerUserId,
        contactId: input.contactId,
        contactName: input.contactName,
        phone: input.phone,
        text: input.text,
        status: "queued",
      })
      .returning();

    if (!message) throw new Error("Outbound message reservation could not be saved.");
    return message;
  }));
}
