import { env } from "cloudflare:workers";
import type { AuthRequest, OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { Hono } from "hono";
import { fetchUpstreamAuthToken, getUpstreamAuthorizeUrl, type Props } from "./utils";
import { adminApp, isUserAllowed } from "./admin";
import {
	addApprovedClient,
	bindStateToSession,
	createOAuthState,
	generateCSRFProtection,
	isClientApproved,
	OAuthError,
	renderApprovalDialog,
	validateCSRFToken,
	validateOAuthState,
} from "./workers-oauth-utils";

const app = new Hono<{ Bindings: Env & { OAUTH_PROVIDER: OAuthHelpers } }>();

app.route("/admin", adminApp);

app.get("/.well-known/oauth-protected-resource*", (c) => {
	const origin = new URL(c.req.url).origin;
	return c.json({
		resource: `${origin}/mcp`,
		authorization_servers: [origin],
		bearer_methods_supported: ["header"],
	});
});

app.get("/authorize", async (c) => {
	const oauthReqInfo = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
	const { clientId } = oauthReqInfo;
	if (!clientId) {
		return c.text("Invalid request", 400);
	}

	if (await isClientApproved(c.req.raw, clientId, env.COOKIE_ENCRYPTION_KEY)) {
		const { stateToken } = await createOAuthState(oauthReqInfo, c.env.OAUTH_KV);
		const { setCookie: sessionBindingCookie } = await bindStateToSession(stateToken);
		return redirectToDiscord(c.req.raw, stateToken, { "Set-Cookie": sessionBindingCookie });
	}

	const { token: csrfToken, setCookie } = generateCSRFProtection();

	return renderApprovalDialog(c.req.raw, {
		client: await c.env.OAUTH_PROVIDER.lookupClient(clientId),
		csrfToken,
		server: {
			name: "GuildBridge",
			description: "Discord MCP Server — access Discord conversations through MCP tools.",
		},
		setCookie,
		state: { oauthReqInfo },
	});
});

app.post("/authorize", async (c) => {
	try {
		const formData = await c.req.raw.formData();
		validateCSRFToken(formData, c.req.raw);

		const encodedState = formData.get("state");
		if (!encodedState || typeof encodedState !== "string") {
			return c.text("Missing state in form data", 400);
		}

		let state: { oauthReqInfo?: AuthRequest };
		try {
			state = JSON.parse(atob(encodedState));
		} catch (_e) {
			return c.text("Invalid state data", 400);
		}

		if (!state.oauthReqInfo || !state.oauthReqInfo.clientId) {
			return c.text("Invalid request", 400);
		}

		const approvedClientCookie = await addApprovedClient(
			c.req.raw,
			state.oauthReqInfo.clientId,
			c.env.COOKIE_ENCRYPTION_KEY,
		);

		const { stateToken } = await createOAuthState(state.oauthReqInfo, c.env.OAUTH_KV);
		const { setCookie: sessionBindingCookie } = await bindStateToSession(stateToken);

		const headers = new Headers();
		headers.append("Set-Cookie", approvedClientCookie);
		headers.append("Set-Cookie", sessionBindingCookie);

		return redirectToDiscord(c.req.raw, stateToken, Object.fromEntries(headers));
	} catch (error: any) {
		console.error("POST /authorize error:", error);
		if (error instanceof OAuthError) {
			return error.toResponse();
		}
		return c.text(`Internal server error: ${error.message}`, 500);
	}
});

async function redirectToDiscord(
	request: Request,
	stateToken: string,
	headers: Record<string, string> = {},
) {
	return new Response(null, {
		status: 302,
		headers: {
			...headers,
			location: getUpstreamAuthorizeUrl({
				client_id: env.DISCORD_CLIENT_ID,
				redirect_uri: new URL("/callback", request.url).href,
				scope: "identify guilds",
				state: stateToken,
				upstream_url: "https://discord.com/oauth2/authorize",
			}),
		},
	});
}

app.get("/callback", async (c) => {
	let oauthReqInfo: AuthRequest;
	let clearSessionCookie: string;

	try {
		const result = await validateOAuthState(c.req.raw, c.env.OAUTH_KV);
		oauthReqInfo = result.oauthReqInfo;
		clearSessionCookie = result.clearCookie;
	} catch (error: any) {
		if (error instanceof OAuthError) {
			return error.toResponse();
		}
		return c.text("Internal server error", 500);
	}

	if (!oauthReqInfo.clientId) {
		return c.text("Invalid OAuth request data", 400);
	}

	const [accessToken, errResponse] = await fetchUpstreamAuthToken({
		client_id: c.env.DISCORD_CLIENT_ID,
		client_secret: c.env.DISCORD_CLIENT_SECRET,
		code: c.req.query("code"),
		redirect_uri: new URL("/callback", c.req.url).href,
		upstream_url: "https://discord.com/api/oauth2/token",
	});
	if (errResponse) return errResponse;

	// Fetch user info from Discord
	const userResp = await fetch("https://discord.com/api/v10/users/@me", {
		headers: { Authorization: `Bearer ${accessToken}` },
	});
	if (!userResp.ok) {
		return c.text("Failed to fetch Discord user info", 500);
	}
	const user = (await userResp.json()) as {
		id: string;
		username: string;
		global_name: string | null;
		avatar: string | null;
	};

	if (!(await isUserAllowed(env.OAUTH_KV, user.id))) {
		return c.text(`Access denied: user ${user.username} (${user.id}) is not authorized`, 403);
	}

	const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
		request: oauthReqInfo,
		userId: user.id,
		metadata: {
			label: user.global_name || user.username,
		},
		scope: oauthReqInfo.scope,
		props: {
			userId: user.id,
			username: user.username,
			globalName: user.global_name,
			avatar: user.avatar,
			accessToken,
		} as Props,
	});

	const headers = new Headers({ Location: redirectTo });
	if (clearSessionCookie) {
		headers.set("Set-Cookie", clearSessionCookie);
	}

	return new Response(null, {
		status: 302,
		headers,
	});
});

export { app as DiscordHandler };
