import { eq } from "drizzle-orm";
import { db, systemSettingsTable } from "@workspace/db";

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
