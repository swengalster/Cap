import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveTxt } from "node:dns/promises";
import {
	checkDomainStatus,
	isSelfHostedDomainMode,
	normalizeOrganizationDomain,
} from "@/actions/organization/domain-utils";

vi.mock("@cap/env", () => ({
	serverEnv: () => ({ WEB_URL: "https://loom.geburtshelden.de" }),
}));

vi.mock("node:dns/promises", () => ({
	resolveTxt: vi.fn(async () => [] as string[][]),
	resolveCname: vi.fn(async () => [] as string[]),
	resolve4: vi.fn(async () => [] as string[]),
}));

describe("self-hosted organization domains", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubEnv("NEXT_PUBLIC_IS_CAP", "");
		vi.stubEnv("DATABASE_ENCRYPTION_KEY", "test-only-domain-verification-key");
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("accepts non-Cloudflare subdomains without a Vercel account", async () => {
		expect(isSelfHostedDomainMode()).toBe(true);
		expect(normalizeOrganizationDomain(" CAP.ISPPM.NGO. ")).toBe(
			"cap.isppm.ngo",
		);
		const result = await checkDomainStatus("cap.isppm.ngo", "org-1");
		expect(result.verified).toBe(false);
		expect(result.config?.recommendedCNAME?.[0]?.value).toBe(
			"loom.geburtshelden.de",
		);
		expect(result.config?.verification?.[0]?.domain).toBe(
			"_cap-verification.cap.isppm.ngo",
		);
	});

	it("requires an organization-specific DNS TXT proof", async () => {
		const initial = await checkDomainStatus("cap.galster.one", "org-1");
		const value = initial.config?.verification?.[0]?.value;
		expect(value).toMatch(/^cap-domain-verification=[a-f0-9]{64}$/);
		vi.mocked(resolveTxt).mockResolvedValue([[value || ""]]);
		const verified = await checkDomainStatus("cap.galster.one", "org-1");
		expect(verified.verified).toBe(true);
		const otherOrg = await checkDomainStatus("cap.galster.one", "org-2");
		expect(otherOrg.verified).toBe(false);
	});

	it("rejects URLs, wildcards and the canonical application domain", () => {
		for (const hostname of [
			"https://cap.galster.one",
			"*.galster.one",
			"loom.geburtshelden.de",
			"127.0.0.1",
			"localhost",
		]) {
			expect(() => normalizeOrganizationDomain(hostname)).toThrow();
		}
	});
});
