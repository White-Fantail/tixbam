/**
 * TIXBAM add-on manifest contract.
 * v0.2: for discovery and compatibility only; remotely supplied code is NOT executed.
 * Future executable packaging requires signature verification and reviewed host permissions.
 */
export type AutomationStatus = "available" | "restricted" | "unverified";
export type AutomationLevel = {
  status: AutomationStatus;
  summary: string;
  sourceUrl?: string;
};
export type AddonManifest = {
  id: string;
  name: string;
  version: string;
  url: string;
  allowedHosts: string[];
  capabilities: Array<"browser" | "persistent-session" | string>;
  automation: {
    reviewedAt: string;
    level1: AutomationLevel;
    level2: AutomationLevel;
    level3: AutomationLevel;
  };
};
export type PublishedAddon = AddonManifest & {
  published: boolean;
  artifactUrl?: string | null;
  artifactSha256?: string | null;
};
