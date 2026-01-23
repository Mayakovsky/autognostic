import { Service, type IAgentRuntime } from "@elizaos/core";
import { Octokit } from "@octokit/rest";

/**
 * GithubService
 * - Wraps Octokit for GitHub reads used by datamirror sources.
 * - Requires static start() for ElizaOS core 1.6+ service registration.
 * - Uses GITHUB_TOKEN if present; works unauthenticated for public repos (rate-limited).
 */
export class GithubService extends Service {
  static readonly serviceType = "github";

  override capabilityDescription =
    "Fetches GitHub repository trees and file contents for mirroring into Knowledge (uses Octokit).";

  private octokit: Octokit;

  /** Required by ElizaOS core (service registration). */
  static async start(runtime: IAgentRuntime): Promise<GithubService> {
    return new GithubService(runtime);
  }

  constructor(runtime: IAgentRuntime) {
    super(runtime);
    const token =
      process.env.GITHUB_TOKEN ||
      (runtime.character as any)?.settings?.datamirror?.github?.token;

    this.octokit = new Octokit(token ? { auth: token } : {});
  }

  override async stop(): Promise<void> {
    // Octokit doesn't need teardown for basic use.
  }

  /**
   * Parse common GitHub URLs into owner/repo/path/ref.
   * Supports:
   * - https://github.com/owner/repo
   * - https://github.com/owner/repo/tree/<ref>/<path>
   * - https://github.com/owner/repo/blob/<ref>/<path>
   */
  parseGithubUrl(url: string): {
    owner: string;
    repo: string;
    ref?: string;
    path?: string;
    kind: "repo" | "tree" | "blob";
  } {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);

    if (parts.length < 2) throw new Error(`Invalid GitHub URL: ${url}`);

    const owner = parts[0];
    const repo = parts[1].replace(/\.git$/, "");

    const kind = (parts[2] as any) as "tree" | "blob" | undefined;
    if (!kind) return { owner, repo, kind: "repo" };

    if (kind !== "tree" && kind !== "blob") return { owner, repo, kind: "repo" };

    const ref = parts[3];
    const path = parts.slice(4).join("/");
    return { owner, repo, ref, path, kind };
  }

  /**
   * List repository tree paths for a ref.
   * If `subdir` is set, filters to that subdirectory.
   */
  async listRepoTree(params: {
    owner: string;
    repo: string;
    ref: string; // branch, tag, or sha
    subdir?: string;
    include?: RegExp; // optional include filter
    exclude?: RegExp; // optional exclude filter
  }): Promise<string[]> {
    const { owner, repo, ref, subdir, include, exclude } = params;

    // GitHub API: get ref SHA then tree
    const refResp = await this.octokit.git.getRef({
      owner,
      repo,
      ref: ref.startsWith("refs/") ? ref.replace(/^refs\//, "") : `heads/${ref}`,
    });

    const sha = refResp.data.object.sha;

    const treeResp = await this.octokit.git.getTree({
      owner,
      repo,
      tree_sha: sha,
      recursive: "true",
    });

    const base = subdir ? subdir.replace(/^\//, "").replace(/\/$/, "") + "/" : "";

    return (treeResp.data.tree ?? [])
      .filter((n) => n.type === "blob" && typeof n.path === "string")
      .map((n) => n.path!)
      .filter((p) => (base ? p.startsWith(base) : true))
      .filter((p) => (include ? include.test(p) : true))
      .filter((p) => (exclude ? !exclude.test(p) : true));
  }

  /**
   * Fetch raw file contents from a repo at a given ref.
   * Uses `repos.getContent` which returns base64 for most text files.
   */
  async getFileText(params: {
    owner: string;
    repo: string;
    path: string;
    ref: string;
    maxBytes?: number;
  }): Promise<string> {
    const { owner, repo, path, ref, maxBytes } = params;

    const resp = await this.octokit.repos.getContent({
      owner,
      repo,
      path,
      ref,
    });

    if (Array.isArray(resp.data)) {
      throw new Error(`Path is a directory, not a file: ${path}`);
    }

    if (!("content" in resp.data) || typeof resp.data.content !== "string") {
      throw new Error(`Unable to read content for ${path}`);
    }

    const buff = Buffer.from(resp.data.content, "base64");
    const cap = maxBytes ?? 2_000_000;
    const sliced = buff.length > cap ? buff.slice(0, cap) : buff;
    return sliced.toString("utf-8");
  }
}
