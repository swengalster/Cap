import { statSync } from "node:fs";
import { resolve, sep } from "node:path";
import { db } from "@cap/database";
import { organizations, videos } from "@cap/database/schema";
import { buildEnv, serverEnv } from "@cap/env";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { type NextRequest, NextResponse, userAgent } from "next/server";
import { getShareIframeRedirectUrl } from "@/lib/share-iframe-navigation";

const addHttps = (s?: string) => {
	if (!s) return s;
	return `https://${s}`;
};

const publicDir = resolve(process.cwd(), "public");

const isPublicAsset = (path: string) => {
	try {
		const file = resolve(publicDir, `.${decodeURIComponent(path)}`);
		if (!file.startsWith(`${publicDir}${sep}`)) return false;
		return statSync(file, { throwIfNoEntry: false })?.isFile() ?? false;
	} catch {
		return false;
	}
};

const mainOrigins = [
	"https://cap.so",
	"https://cap.link",
	"http://localhost",
	serverEnv().WEB_URL,
	addHttps(serverEnv().VERCEL_URL_HOST),
	addHttps(serverEnv().VERCEL_BRANCH_URL_HOST),
	addHttps(serverEnv().VERCEL_PROJECT_PRODUCTION_URL_HOST),
].filter(Boolean) as string[];

export async function proxy(request: NextRequest) {
	const url = new URL(request.url);
	const path = url.pathname;

	if (path === "/" && request.cookies.has("next-auth.session-token")) {
		return NextResponse.redirect(new URL("/dashboard/caps", url.origin));
	}

	if (path.startsWith("/login")) {
		const response = NextResponse.next();
		response.headers.set("X-Frame-Options", "SAMEORIGIN");
		response.headers.set(
			"Content-Security-Policy",
			"frame-ancestors https://cap.so",
		);
		return response;
	}

	const shareIframeRedirectUrl = getShareIframeRedirectUrl({
		method: request.method,
		requestUrl: request.url,
		fetchDestination: request.headers.get("sec-fetch-dest"),
	});
	if (shareIframeRedirectUrl) {
		const response = NextResponse.redirect(shareIframeRedirectUrl);
		response.headers.set("Cache-Control", "private, no-store");
		response.headers.set("Vary", "Sec-Fetch-Dest");
		return response;
	}

	const hostname = url.hostname;

	// Custom hostnames on a self-hosted instance only serve videos belonging
	// to the verified organization. Sign-in and dashboards stay on WEB_URL.
	if (
		buildEnv.NEXT_PUBLIC_IS_CAP !== "true" &&
		process.env.NODE_ENV !== "development"
	) {
		const primary = new URL(serverEnv().WEB_URL);
		// The standalone server builds request.url from its bind address
		// (0.0.0.0), so the public hostname has to come from the Host header.
		const requestHost = (request.headers.get("host") ?? hostname)
			.replace(/:\d+$/, "")
			.toLowerCase();
		if (
			requestHost !== primary.hostname &&
			requestHost !== "localhost" &&
			requestHost !== "127.0.0.1"
		) {
			const fallback = new URL(path + url.search, primary);
			const videoId = /^\/s\/([^/]+)\/?$/.exec(path)?.[1];
			if (!videoId) return NextResponse.redirect(fallback);
			try {
				const [organization] = await db()
					.select({
						id: organizations.id,
						verified: organizations.domainVerified,
					})
					.from(organizations)
					.where(eq(organizations.customDomain, requestHost))
					.limit(1);
				if (!organization?.verified) return NextResponse.redirect(fallback);
				const [video] = await db()
					.select({ orgId: videos.orgId })
					.from(videos)
					.where(eq(videos.id, videoId as typeof videos.$inferSelect.id))
					.limit(1);
				if (!video || video.orgId !== organization.id)
					return NextResponse.redirect(fallback);
				return NextResponse.next();
			} catch (error) {
				console.error("Self-hosted domain resolution failed", error);
				return NextResponse.redirect(fallback);
			}
		}
	}

	if (buildEnv.NEXT_PUBLIC_IS_CAP !== "true") {
		// Files under public/ have no route of their own, so without this every
		// <img src="/logos/..."> on a self-hosted instance redirects to /login.
		if (
			!(
				isPublicAsset(path) ||
				path.startsWith("/s/") ||
				path.startsWith("/c/") ||
				path.startsWith("/cli/") ||
				path.startsWith("/mcp/") ||
				path.startsWith("/middleware") ||
				path.startsWith("/dashboard") ||
				path.startsWith("/onboarding") ||
				path.startsWith("/api") ||
				path.startsWith("/login") ||
				path.startsWith("/signup") ||
				path.startsWith("/invite") ||
				path.startsWith("/self-hosting") ||
				path.startsWith("/download") ||
				path.startsWith("/terms") ||
				path.startsWith("/verify-otp") ||
				path.startsWith("/embed/") ||
				path.startsWith("/.well-known/workflow/") ||
				path.startsWith("/.well-known/oauth-") ||
				isPublicAsset(path)
			) &&
			process.env.NODE_ENV !== "development"
		)
			return NextResponse.redirect(new URL("/login", url.origin));
		else return NextResponse.next();
	}

	if (mainOrigins.some((d) => url.origin.startsWith(d))) {
		return NextResponse.next();
	}

	const webUrl = new URL(serverEnv().WEB_URL).hostname;

	try {
		if (!(path.startsWith("/s/") || path.startsWith("/c/"))) {
			const url = new URL(request.url);
			url.hostname = webUrl;
			return NextResponse.redirect(url);
		}

		const verifiedDomain = request.cookies.get("verified_domain");
		if (verifiedDomain?.value === hostname) return NextResponse.next();

		const [organization] = await db()
			.select()
			.from(organizations)
			.where(eq(organizations.customDomain, hostname));

		if (!organization || !organization.domainVerified) {
			const url = new URL(request.url);
			url.hostname = webUrl;
			return NextResponse.redirect(url);
		}

		const response = NextResponse.next();
		response.cookies.set("verified_domain", hostname, {
			httpOnly: true,
			secure: process.env.NODE_ENV === "production",
			sameSite: "strict",
			maxAge: 3600,
		});

		const { pathname } = request.nextUrl;
		const referrer = request.headers.get("referer") || "";

		const ua = userAgent(request);

		response.headers.set("x-pathname", pathname);
		response.headers.set("x-referrer", referrer);
		response.headers.set("x-user-agent", JSON.stringify(ua));

		return response;
	} catch (error) {
		console.error("Error in proxy:", error);
		return notFound();
	}
}

export const config = {
	matcher: [
		"/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)",
	],
};
