import { createHmac } from "node:crypto";
import { resolve4, resolveCname, resolveTxt } from "node:dns/promises";
import { serverEnv } from "@cap/env";

// Cap Cloud delegates domain management to Vercel; self-hosting uses DNS proof.
export const isSelfHostedDomainMode = () =>
	process.env.NEXT_PUBLIC_IS_CAP !== "true";

export const normalizeOrganizationDomain = (input: string) => {
	const domain = input.trim().toLowerCase().replace(/\.$/, "");
	if (
		!^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(domain) ||
		domain === "cap.so" ||
		domain === "cap.link" ||
		domain === new URL(serverEnv().WEB_URL).hostname.toLowerCase()
	) {
		throw new Error("Enter a valid hostname different from the main Cap domain.");
	}
	return domain;
};

const ownershipRecord = (domain: string, organizationId: string) => {
	const secret = process.env.DATABASE_ENCRYPTION_KEY;
	if (!secret) {
		throw new Error("Domain verification requires DATABASE_ENCRYPTION_KEY.");
	}
	return {
		host: "_cap-verification." + domain,
		value: "cap-domain-verification=" + createHmac("sha256", secret)
			.update(organizationId + ":" + domain)
			.digest("hex"),
	};
};

const checkSelfHostedDomain = async (domain: string, organizationId: string) => {
	const { host, value } = ownershipRecord(domain, organizationId);
	const primaryHostname = new URL(serverEnv().WEB_URL).hostname;
	const [txtRecords, currentCnames, currentAValues] = await Promise.all([
		resolveTxt(host).catch(() => [] as string[][]),
		resolveCname(domain).catch(() => [] as string[]),
		resolve4(domain).catch(() => [] as string[]),
	]);
	const verified = txtRecords.some((record) => record.join("") === value);
	return {
		verified,
		config: {
			name: domain,
			apexName: domain,
			verified,
			misconfigured: !verified,
			verification: [
				{ type: "TXT", domain: host, value, reason: "Prove DNS ownership" },
			],
			recommendedCNAME: [{ rank: 1, value: primaryHostname }],
			cnames: currentCnames,
			currentAValues,
		},
		status: { verified },
	};
};

export const getConfigResponse = async (domain: string) => {
	const response = await fetch(
		`https://api.vercel.com/v6/domains/${domain.toLowerCase()}/config?teamId=${
			process.env.VERCEL_TEAM_ID
		}&strict=true`,
		{
			method: "GET",
			headers: {
				Authorization: `Bearer ${process.env.VERCEL_AUTH_TOKEN}`,
				"Content-Type": "application/json",
			},
			cache: "no-store",
		},
	).then((res) => res.json());
	return response;
};

export const getDomainResponse = async (domain: string) => {
	const response = await fetch(
		`https://api.vercel.com/v9/projects/${
			process.env.VERCEL_PROJECT_ID
		}/domains/${domain.toLowerCase()}?teamId=${process.env.VERCEL_TEAM_ID}`,
		{
			method: "GET",
			headers: {
				Authorization: `Bearer ${process.env.VERCEL_AUTH_TOKEN}`,
				"Content-Type": "application/json",
			},
			cache: "no-store",
		},
	).then((res) => res.json());
	return response;
};

export const verifyDomain = async (domain: string) => {
	const response = await fetch(
		`https://api.vercel.com/v9/projects/${
			process.env.VERCEL_PROJECT_ID
		}/domains/${domain.toLowerCase()}/verify?teamId=${
			process.env.VERCEL_TEAM_ID
		}&strict=true`,
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${process.env.VERCEL_AUTH_TOKEN}`,
				"Content-Type": "application/json",
			},
		},
	).then((res) => res.json());
	return response;
};

export const addDomain = async (domain: string) => {
	if (isSelfHostedDomainMode()) return {};

	const response = await fetch(
		`https://api.vercel.com/v9/projects/${process.env.VERCEL_PROJECT_ID}/domains?teamId=${process.env.VERCEL_TEAM_ID}`,
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${process.env.VERCEL_AUTH_TOKEN}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ name: domain }),
			cache: "no-store",
		},
	).then((res) => res.json());

	return response;
};

export const getRequiredConfig = async (domain: string) => {
	// First try to get the records directly
	try {
		const recordsResponse = await fetch(
			`https://api.vercel.com/v4/domains/${domain.toLowerCase()}/records?limit=10&teamId=${
				process.env.VERCEL_TEAM_ID
			}`,
			{
				method: "GET",
				headers: {
					Authorization: `Bearer ${process.env.VERCEL_AUTH_TOKEN}`,
					"Content-Type": "application/json",
				},
				cache: "no-store",
			},
		).then((res) => res.json());

		if (recordsResponse.records) {
			const aRecord = recordsResponse.records.find(
				(record: any) => record.type === "A" && record.name === "",
			);

			if (aRecord) {
				return {
					configuredBy: "vercel",
					aValues: [aRecord.value],
					serviceType: "vercel",
				};
			}
		}
	} catch (_error) {
		// Continue to fallback
	}

	// Fallback to the old config endpoint
	const response = await fetch(
		`https://api.vercel.com/v6/domains/${domain.toLowerCase()}/config?teamId=${
			process.env.VERCEL_TEAM_ID
		}`,
		{
			method: "GET",
			headers: {
				Authorization: `Bearer ${process.env.VERCEL_AUTH_TOKEN}`,
				"Content-Type": "application/json",
			},
			cache: "no-store",
		},
	).then((res) => res.json());

	// If we still don't have the A record, try the project domains endpoint
	if (!response.aValues || response.aValues.length === 0) {
		const projectResponse = await fetch(
			`https://api.vercel.com/v9/projects/${process.env.VERCEL_PROJECT_ID}/domains?teamId=${process.env.VERCEL_TEAM_ID}`,
			{
				method: "GET",
				headers: {
					Authorization: `Bearer ${process.env.VERCEL_AUTH_TOKEN}`,
					"Content-Type": "application/json",
				},
				cache: "no-store",
			},
		).then((res) => res.json());

		if (projectResponse.domains) {
			const projectDomain = projectResponse.domains.find(
				(d: any) => d.name === domain,
			);
			if (projectDomain?.apexValue) {
				response.aValues = [projectDomain.apexValue];
			}
		}
	}

	return response;
};

export const checkDomainStatus = async (
	domain: string,
	organizationId?: string,
) => {
	if (isSelfHostedDomainMode()) {
		if (!organizationId) throw new Error("Organization ID is required for verification.");
		return checkSelfHostedDomain(domain, organizationId);
	}

	try {
		const [domainJson, configJson, requiredConfigJson] = await Promise.all([
			getDomainResponse(domain),
			getConfigResponse(domain),
			getRequiredConfig(domain),
		]);

		let verified = false;

		if (configJson.misconfigured || domainJson?.error?.code === "not_found") {
			verified = false;
		} else if (domainJson.verified) {
			verified = true;
		} else {
			const verificationJson = await verifyDomain(domain);
			verified = verificationJson?.verified;
		}

		// Get the current and required A records
		const currentAValues = configJson.aValues || [];
		const requiredAValue = requiredConfigJson.aValues?.[0];

		return {
			verified,
			config: {
				...configJson,
				verification: domainJson?.verification || [],
				currentAValues,
				requiredAValue,
			},
			status: domainJson,
		};
	} catch (_error) {
		return {
			verified: false,
			error: "Failed to check domain status",
		};
	}
};
