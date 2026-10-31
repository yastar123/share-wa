import { eq } from "drizzle-orm";
import { db, systemSettingsTable } from "@workspace/db";

export const DEFAULT_OUTBOUND_MESSAGE_LIMITS = {
  maxBatchSize: 5,
  maxMessagesPerHour: 20,
  delayBetweenMessagesMs: 3000,
} as const;

export type OutboundMessageLimits = {
  maxBatchSize: number;
  maxMessagesPerHour: number;
  delayBetweenMessagesMs: number;
};

export async function getOutboundMessageLimits(): Promise<OutboundMessageLimits> {
  const [settings] = await db
    .select({ outboundMessageLimits: systemSettingsTable.outboundMessageLimits })
    .from(systemSettingsTable)
    .where(eq(systemSettingsTable.id, 1))
    .limit(1);

  return { ...DEFAULT_OUTBOUND_MESSAGE_LIMITS, ...settings?.outboundMessageLimits };
}

export async function isOutboundMessagingEnabled(): Promise<boolean> {
  const [settings] = await db
    .select({
      outboundMessagingEnabled: systemSettingsTable.outboundMessagingEnabled,
    })
    .from(systemSettingsTable)
    .where(eq(systemSettingsTable.id, 1))
    .limit(1);

  return settings?.outboundMessagingEnabled ?? true;
}
