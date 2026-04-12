/**
 * Constructs an authorization URL for Discord OAuth2.
 */
export function getUpstreamAuthorizeUrl({
	upstream_url,
	client_id,
	scope,
	redirect_uri,
	state,
}: {
	upstream_url: string;
	client_id: string;
	scope: string;
	redirect_uri: string;
	state?: string;
}) {
	const upstream = new URL(upstream_url);
	upstream.searchParams.set("client_id", client_id);
	upstream.searchParams.set("redirect_uri", redirect_uri);
	upstream.searchParams.set("scope", scope);
	if (state) upstream.searchParams.set("state", state);
	upstream.searchParams.set("response_type", "code");
	return upstream.href;
}

/**
 * Exchanges an authorization code for an access token at Discord's token endpoint.
 * Discord returns JSON (not form-encoded like GitHub).
 */
export interface UpstreamToken {
	accessToken: string;
	expiresAt: number; // epoch ms when the Discord token expires (0 = unknown)
}

export async function fetchUpstreamAuthToken({
	client_id,
	client_secret,
	code,
	redirect_uri,
	upstream_url,
}: {
	code: string | undefined;
	upstream_url: string;
	client_secret: string;
	redirect_uri: string;
	client_id: string;
}): Promise<[UpstreamToken, null] | [null, Response]> {
	if (!code) {
		return [null, new Response("Missing code", { status: 400 })];
	}

	const resp = await fetch(upstream_url, {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
		},
		body: new URLSearchParams({
			client_id,
			client_secret,
			code,
			redirect_uri,
			grant_type: "authorization_code",
		}).toString(),
	});

	if (!resp.ok) {
		console.log("Discord token exchange failed:", await resp.text());
		return [null, new Response("Failed to fetch access token", { status: 500 })];
	}

	const body = (await resp.json()) as { access_token?: string; expires_in?: number };
	const accessToken = body.access_token;
	if (!accessToken) {
		return [null, new Response("Missing access token in response", { status: 400 })];
	}

	const expiresAt = body.expires_in
		? Date.now() + body.expires_in * 1000
		: 0;

	return [{ accessToken, expiresAt }, null];
}

// Context from the auth process, encrypted & stored in the auth token
// and provided to the McpAgent as this.props
export type Props = {
	userId: string;
	username: string;
	globalName: string | null;
	avatar: string | null;
	accessToken: string;
	expiresAt: number; // epoch ms when the Discord token expires (0 = unknown)
};
