import type { IAgentRuntime } from "@elizaos/core";
import { eq } from "drizzle-orm";
import { autognosticSettings, type AutognosticSettingsRow } from "./schema";
import { DEFAULT_SIZE_POLICY, type AutognosticSizePolicy } from "../config/SizePolicy";
import { getDb } from "./getDb";

export class AutognosticSettingsRepository {
  constructor(private runtime: IAgentRuntime) {}

  async getPolicy(agentId: string): Promise<AutognosticSizePolicy> {
    const db = await getDb(this.runtime);

    const rows: AutognosticSettingsRow[] = await db
      .select()
      .from(autognosticSettings)
      .where(eq(autognosticSettings.agentId, agentId))
      .limit(1);

    const row = rows[0];
    if (!row) return DEFAULT_SIZE_POLICY;

    return {
      ...DEFAULT_SIZE_POLICY,
      ...(row.sizePolicyJson as AutognosticSizePolicy),
    };
  }

  async upsertPolicy(agentId: string, policy: AutognosticSizePolicy): Promise<void> {
    const db = await getDb(this.runtime);

    const existingRows: AutognosticSettingsRow[] = await db
      .select()
      .from(autognosticSettings)
      .where(eq(autognosticSettings.agentId, agentId))
      .limit(1);

    if (!existingRows[0]) {
      await db.insert(autognosticSettings).values({
        agentId,
        sizePolicyJson: policy,
      });
    } else {
      await db
        .update(autognosticSettings)
        .set({ sizePolicyJson: policy })
        .where(eq(autognosticSettings.agentId, agentId));
    }
  }
}
