import type { IAgentRuntime } from "@elizaos/core";
import { eq } from "drizzle-orm";
import {
  datamirrorRefreshSettings,
  type DatamirrorRefreshSettingsRow,
} from "./schema";
import {
  DEFAULT_REFRESH_POLICY,
  type DatamirrorRefreshPolicy,
} from "../config/RefreshPolicy";
import { getDb } from "./getDb";

export class DatamirrorRefreshSettingsRepository {
  constructor(private runtime: IAgentRuntime) {}

  async getPolicy(agentId: string): Promise<DatamirrorRefreshPolicy> {
    const db = await getDb(this.runtime);

    const rows: DatamirrorRefreshSettingsRow[] = await db
      .select()
      .from(datamirrorRefreshSettings)
      .where(eq(datamirrorRefreshSettings.agentId, agentId))
      .limit(1);

    const row = rows[0];
    if (!row) return DEFAULT_REFRESH_POLICY;

    return {
      ...DEFAULT_REFRESH_POLICY,
      ...(row.refreshPolicyJson as DatamirrorRefreshPolicy),
    };
  }

  async upsertPolicy(
    agentId: string,
    policy: DatamirrorRefreshPolicy
  ): Promise<void> {
    const db = await getDb(this.runtime);

    const existingRows: DatamirrorRefreshSettingsRow[] = await db
      .select()
      .from(datamirrorRefreshSettings)
      .where(eq(datamirrorRefreshSettings.agentId, agentId))
      .limit(1);

    if (!existingRows[0]) {
      await db.insert(datamirrorRefreshSettings).values({
        agentId,
        refreshPolicyJson: policy,
      });
    } else {
      await db
        .update(datamirrorRefreshSettings)
        .set({ refreshPolicyJson: policy })
        .where(eq(datamirrorRefreshSettings.agentId, agentId));
    }
  }
}
