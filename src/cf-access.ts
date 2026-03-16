// Cloudflare Access JWT validation middleware for Hono

import { createMiddleware } from "hono/factory";

interface JWK {
	kty: string;
	kid: string;
	n: string;
	e: string;
	alg: string;
	use: string;
}

interface JWKS {
	keys: JWK[];
}

let cachedJWKS: JWKS | null = null;
let jwksCachedAt = 0;
const JWKS_TTL = 3600_000; // 1 hour

async function fetchJWKS(teamDomain: string): Promise<JWKS> {
	if (cachedJWKS && Date.now() - jwksCachedAt < JWKS_TTL) {
		return cachedJWKS;
	}
	const resp = await fetch(`https://${teamDomain}.cloudflareaccess.com/cdn-cgi/access/certs`);
	if (!resp.ok) {
		throw new Error(`Failed to fetch JWKS: ${resp.status}`);
	}
	cachedJWKS = await resp.json() as JWKS;
	jwksCachedAt = Date.now();
	return cachedJWKS;
}

function base64UrlToArrayBuffer(base64url: string): ArrayBuffer {
	const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
	const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
	const binary = atob(padded);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes.buffer;
}

async function importRSAKey(jwk: JWK): Promise<CryptoKey> {
	return crypto.subtle.importKey(
		"jwk",
		{ kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
		{ name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
		false,
		["verify"],
	);
}

async function verifyToken(
	token: string,
	teamDomain: string,
	aud: string,
): Promise<{ email: string }> {
	const parts = token.split(".");
	if (parts.length !== 3) {
		throw new Error("Invalid JWT format");
	}
	const [headerB64, payloadB64, signatureB64] = parts;

	const header = JSON.parse(new TextDecoder().decode(base64UrlToArrayBuffer(headerB64)));
	if (header.alg !== "RS256") {
		throw new Error(`Unsupported algorithm: ${header.alg}`);
	}

	const jwks = await fetchJWKS(teamDomain);
	const jwk = jwks.keys.find((k) => k.kid === header.kid);
	if (!jwk) {
		throw new Error("No matching key found in JWKS");
	}

	const key = await importRSAKey(jwk);
	const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
	const signature = base64UrlToArrayBuffer(signatureB64);

	const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, data);
	if (!valid) {
		throw new Error("Invalid JWT signature");
	}

	const payload = JSON.parse(new TextDecoder().decode(base64UrlToArrayBuffer(payloadB64)));

	// Validate claims
	const now = Math.floor(Date.now() / 1000);
	if (payload.exp && payload.exp < now) {
		throw new Error("Token expired");
	}
	if (payload.iss !== `https://${teamDomain}.cloudflareaccess.com`) {
		throw new Error("Invalid issuer");
	}
	if (!payload.aud?.includes(aud)) {
		throw new Error("Invalid audience");
	}

	return { email: payload.email };
}

type CfAccessEnv = {
	CF_ACCESS_TEAM_DOMAIN: string;
	CF_ACCESS_AUD: string;
	DEV_SKIP_CF_ACCESS?: string;
};

export const cfAccessMiddleware = createMiddleware<{
	Bindings: CfAccessEnv;
	Variables: { cfAccessEmail: string };
}>(async (c, next) => {
	if (c.env.DEV_SKIP_CF_ACCESS) {
		c.set("cfAccessEmail", "dev@localhost");
		return next();
	}

	const token = c.req.header("Cf-Access-Jwt-Assertion");
	if (!token) {
		return c.text("Forbidden: missing CF Access token", 403);
	}

	try {
		const { email } = await verifyToken(token, c.env.CF_ACCESS_TEAM_DOMAIN, c.env.CF_ACCESS_AUD);
		c.set("cfAccessEmail", email);
		return next();
	} catch (err: any) {
		console.error("CF Access JWT validation failed:", err.message);
		return c.text("Forbidden: invalid CF Access token", 403);
	}
});
