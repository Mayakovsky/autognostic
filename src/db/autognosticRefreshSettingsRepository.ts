import type { IAgentRuntime } from "@elizaos/core";
import { eq } from "drizzle-orm";
import {
  autognosticRefreshSettings,
  type AutognosticRefreshSettingsRow,
} from "./schema";
import {
  DEFAULT_REFRESH_POLICY,
  type AutognosticRefreshPolicy,
} from "../config/RefreshPolicy";
import { getDb } from "./getDb";

export class AutognosticRefreshSettingsRepository {
  constructor(private runtime: IAgentRuntime) {}

  async getPolicy(agentId: string): Promise<AutognosticRefreshPolicy> {
    const db = await getDb(this.runtime);

    const rows: AutognosticRefreshSettingsRow[] = await db
      .select()
      .from(autognosticRefreshSettings)
      .where(eq(autognosticRefreshSettings.agentId, agentId))
      .limit(1);

    const row = rows[0];
    if (!row) return DEFAULT_REFRESH_POLICY;

    return {
      ...DEFAULT_REFRESH_POLICY,
      ...(row.refreshPolicyJson as AutognosticRefreshPolicy),
    };
  }

  async upsertPolicy(
    agentId: string,
    policy: AutognosticRefreshPolicy
  ): Promise<void> {
    const db = await getDb(this.runtime);

    const existingRows: AutognosticRefreshSettingsRow[] = await db
      .select()
      .from(autognosticRefreshSettings)
      .where(eq(autognosticRefreshSettings.agentId, agentId))
      .limit(1);

    if (!existingRows[0]) {
      await db.insert(autognosticRefreshSettings).values({
        agentId,
        refreshPolicyJson: policy,
      });
    } else {
      await db
        .update(autognosticRefreshSettings)
        .set({ refreshPolicyJson: policy })
        .where(eq(autognosticRefreshSettings.agentId, agentId));
    }
  }
}
