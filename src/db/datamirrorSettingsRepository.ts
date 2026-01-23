import type { IAgentRuntime } from "@elizaos/core";
import { eq } from "drizzle-orm";
import { datamirrorSettings, type DatamirrorSettingsRow } from "./schema";
import { DEFAULT_SIZE_POLICY, type DatamirrorSizePolicy } from "../config/SizePolicy";
import { getDb } from "./getDb";

export class DatamirrorSettingsRepository {
  constructor(private runtime: IAgentRuntime) {}

  async getPolicy(agentId: string): Promise<DatamirrorSizePolicy> {
    const db = await getDb(this.runtime);

    const rows: DatamirrorSettingsRow[] = await db
      .select()
      .from(datamirrorSettings)
      .where(eq(datamirrorSettings.agentId, agentId))
      .limit(1);

    const row = rows[0];
    if (!row) return DEFAULT_SIZE_POLICY;

    return {
      ...DEFAULT_SIZE_POLICY,
      ...(row.sizePolicyJson as DatamirrorSizePolicy),
    };
  }

  async upsertPolicy(agentId: string, policy: DatamirrorSizePolicy): Promise<void> {
    const db = await getDb(this.runtime);

    const existingRows: DatamirrorSettingsRow[] = await db
      .select()
      .from(datamirrorSettings)
      .where(eq(datamirrorSettings.agentId, agentId))
      .limit(1);

    if (!existingRows[0]) {
      await db.insert(datamirrorSettings).values({
        agentId,
        sizePolicyJson: policy,
      });
    } else {
      await db
        .update(datamirrorSettings)
        .set({ sizePolicyJson: policy })
        .where(eq(datamirrorSettings.agentId, agentId));
    }
  }
}
