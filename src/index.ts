import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";
import { DiscordHandler } from "./discord-handler";
import { isUserAllowed } from "./admin";
import {
	DiscordApiError,
	listBotGuilds,
	listUserGuilds,
	listChannels,
	getChannel,
	readMessages,
	sendMessage,
	replyToMessage,
	searchMessages,
	getGuildMember,
	getGuildRoles,
	getGuild,
	computePermissions,
	VIEW_CHANNEL,
	CHANNEL_TYPE_NAMES,
	type DiscordEmbed,
} from "./discord-api";
import type { Props } from "./utils";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { recordAudit, extractResourceIds, type AuditContext } from "./audit";

export class GuildBridgeMCP extends McpAgent<Env, Record<string, never>, Props> {
	server = new McpServer({
		name: "GuildBridge",
		version: "1.0.0",
	});

	async init() {
		const botToken = this.env.DISCORD_BOT_TOKEN;

		if (!this.props?.accessToken) {
			throw new Error("Not authenticated");
		}
		const accessToken = this.props.accessToken;
		const userId = this.props.userId;
		const tokenExpiresAt = this.props.expiresAt;
		const oauthKv = this.env.OAUTH_KV;
		const username = this.props.username;
		const globalName = this.props.globalName;
		const avatar = this.props.avatar;
		const env = this.env;
		const waitUntil = this.ctx.waitUntil.bind(this.ctx);

		const attributionEmbed: DiscordEmbed = {
			author: {
				name: globalName ?? username,
				...(avatar && { icon_url: `https://cdn.discordapp.com/avatars/${userId}/${avatar}.png` }),
			},
			footer: { text: "via GuildBridge" },
		};

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		type ToolHandler<A> = (args: A, audit: AuditContext) => Promise<CallToolResult>;
		const tool = <Args extends z.ZodRawShape>(
			name: string,
			description: string,
			schema: Args,
			handler: ToolHandler<z.output<z.ZodObject<Args>>>,
		) => {
			// The SDK's ZodRawShapeCompat unions zod v3 and v4 types and TS can't
			// unify the generic through both layers. Schema and args pass through
			// unchanged; call-site typing is enforced by the handler param above.
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			this.server.tool(name, description, schema as any, async (args: any) => {
				const start = Date.now();
				const auditCtx: AuditContext = {};
				const ids = extractResourceIds(args);
				try {
					const result = await handler(args, auditCtx);
					recordAudit(env, waitUntil, {
						tool: name,
						userId,
						username,
						outcome: "ok",
						durationMs: Date.now() - start,
						...ids,
						messageId: auditCtx.messageId,
					});
					return result;
				} catch (err) {
					recordAudit(env, waitUntil, {
						tool: name,
						userId,
						username,
						outcome: "error",
						durationMs: Date.now() - start,
						...ids,
						error: err instanceof Error ? err.message : String(err),
					});
					throw err;
				}
			});
		};

		let cachedGuildIds: Set<string> | null = null;
		let cachedAt = 0;

		const getUserGuildIds = async () => {
			if (tokenExpiresAt && tokenExpiresAt < Date.now() + TOKEN_EXPIRY_BUFFER_MS) {
				throw new Error(
					"Your Discord authorization has expired. Please re-authenticate to continue.",
				);
			}
			if (cachedGuildIds && Date.now() - cachedAt < 60_000) {
				return cachedGuildIds;
			}
			// Re-check allowlist on cache miss (~every 60s)
			if (!(await isUserAllowed(oauthKv, userId))) {
				throw new Error("Access denied: you are no longer authorized.");
			}
			try {
				const userGuilds = await listUserGuilds(accessToken);
				cachedGuildIds = new Set(userGuilds.map((g) => g.id));
				cachedAt = Date.now();
				return cachedGuildIds;
			} catch (err) {
				if (err instanceof DiscordApiError && err.status === 401) {
					throw new Error(
						"Your Discord authorization has expired or been revoked. Please re-authenticate to continue.",
					);
				}
				throw err;
			}
		};

		const assertGuildAccess = async (guildId: string) => {
			const guildIds = await getUserGuildIds();
			if (!guildIds.has(guildId)) {
				throw new Error(`Access denied: you are not a member of guild ${guildId}`);
			}
		};

		const guildPermCache = new Map<string, {
			roles: import("./discord-api").DiscordRole[];
			memberRoleIds: string[];
			ownerId: string;
			cachedAt: number;
		}>();

		const getGuildPermContext = async (guildId: string) => {
			const cached = guildPermCache.get(guildId);
			if (cached && Date.now() - cached.cachedAt < 60_000) return cached;

			const [roles, member, guild] = await Promise.all([
				getGuildRoles(botToken, guildId),
				getGuildMember(botToken, guildId, userId),
				getGuild(botToken, guildId),
			]);

			const ctx = { roles, memberRoleIds: member.roles, ownerId: guild.owner_id ?? "", cachedAt: Date.now() };
			guildPermCache.set(guildId, ctx);
			return ctx;
		};

		const assertChannelAccess = async (channelId: string) => {
			const channel = await getChannel(botToken, channelId);
			if (!channel.guild_id) {
				throw new Error(`Channel ${channelId} is not in a guild`);
			}
			await assertGuildAccess(channel.guild_id);

			const { roles, memberRoleIds, ownerId } = await getGuildPermContext(channel.guild_id);
			if (ownerId === userId) return;

			const perms = computePermissions(
				channel.guild_id, userId, memberRoleIds, roles,
				channel.permission_overwrites ?? [],
			);
			if (!(perms & VIEW_CHANNEL)) {
				throw new Error(`Access denied: you do not have access to channel ${channelId}`);
			}
		};

		tool("list_guilds", "List Discord servers you are in", {}, async () => {
			const userGuildIds = await getUserGuildIds();
			const botGuilds = await listBotGuilds(botToken);
			const guilds = botGuilds.filter((g) => userGuildIds.has(g.id));
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(
							guilds.map((g) => ({ id: g.id, name: g.name, icon: g.icon })),
							null,
							2,
						),
					},
				],
			};
		});

		tool(
			"list_channels",
			"List channels in a Discord server, optionally filtered by type",
			{
				guild_id: z.string().describe("The Discord server (guild) ID"),
				type: z
					.string()
					.optional()
					.describe(
						"Filter by channel type name (e.g. 'text', 'voice', 'forum', 'category')",
					),
			},
			async ({ guild_id, type }) => {
				await assertGuildAccess(guild_id);
				const channels = await listChannels(botToken, guild_id);

				const { roles, memberRoleIds, ownerId } = await getGuildPermContext(guild_id);
				let filtered = channels;
				if (ownerId !== userId) {
					filtered = channels.filter((ch) => {
						const perms = computePermissions(guild_id, userId, memberRoleIds, roles, ch.permission_overwrites ?? []);
						return Boolean(perms & VIEW_CHANNEL);
					});
				}

				if (type) {
					const typeEntry = Object.entries(CHANNEL_TYPE_NAMES).find(
						([, name]) => name === type.toLowerCase(),
					);
					if (typeEntry) {
						const typeNum = parseInt(typeEntry[0]);
						filtered = filtered.filter((ch) => ch.type === typeNum);
					}
				}

				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(
								filtered.map((ch) => ({
									id: ch.id,
									name: ch.name,
									type: CHANNEL_TYPE_NAMES[ch.type] || ch.type,
									topic: ch.topic,
									parent_id: ch.parent_id,
									position: ch.position,
								})),
								null,
								2,
							),
						},
					],
				};
			},
		);

		tool(
			"get_channel_info",
			"Get details about a specific Discord channel",
			{
				channel_id: z.string().describe("The Discord channel ID"),
			},
			async ({ channel_id }) => {
				await assertChannelAccess(channel_id);
				const ch = await getChannel(botToken, channel_id);
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(
								{
									id: ch.id,
									name: ch.name,
									type: CHANNEL_TYPE_NAMES[ch.type] || ch.type,
									topic: ch.topic,
									guild_id: ch.guild_id,
									parent_id: ch.parent_id,
									nsfw: ch.nsfw,
								},
								null,
								2,
							),
						},
					],
				};
			},
		);

		tool(
			"read_messages",
			"Read messages from a Discord channel",
			{
				channel_id: z.string().describe("The Discord channel ID"),
				limit: z
					.number()
					.int()
					.min(1)
					.max(100)
					.optional()
					.describe("Number of messages to fetch (1-100, default 50)"),
				before: z.string().optional().describe("Get messages before this message ID"),
				after: z.string().optional().describe("Get messages after this message ID"),
			},
			async ({ channel_id, limit, before, after }) => {
				await assertChannelAccess(channel_id);
				const messages = await readMessages(botToken, channel_id, {
					limit: limit ?? 50,
					before,
					after,
				});
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(
								messages.map((m) => ({
									id: m.id,
									author: {
										id: m.author.id,
										username: m.author.username,
										global_name: m.author.global_name,
										bot: m.author.bot,
									},
									content: m.content,
									timestamp: m.timestamp,
									edited_timestamp: m.edited_timestamp,
									attachments: m.attachments.map((a) => ({
										filename: a.filename,
										url: a.url,
										content_type: a.content_type,
									})),
									embeds: m.embeds.length > 0 ? m.embeds : undefined,
									reply_to: m.referenced_message
										? {
											id: m.referenced_message.id,
											author: m.referenced_message.author.username,
											content: m.referenced_message.content.slice(0, 100),
										}
										: undefined,
								})),
								null,
								2,
							),
						},
					],
				};
			},
		);

		tool(
			"search_messages",
			"Search messages in a Discord server",
			{
				guild_id: z.string().describe("The Discord server (guild) ID"),
				query: z.string().describe("Search query string"),
				channel_id: z.string().optional().describe("Filter to a specific channel"),
				author_id: z.string().optional().describe("Filter to a specific author"),
				limit: z
					.number()
					.int()
					.min(1)
					.max(25)
					.optional()
					.describe("Number of results (1-25, default 25)"),
				sort_by: z
					.string()
					.optional()
					.describe("Sort field (e.g. 'timestamp', 'relevance')"),
				sort_order: z.string().optional().describe("Sort order ('asc' or 'desc')"),
			},
			async ({ guild_id, query, channel_id, author_id, limit, sort_by, sort_order }) => {
				await assertGuildAccess(guild_id);
				const result = await searchMessages(botToken, guild_id, query, {
					channelId: channel_id,
					authorId: author_id,
					limit: limit ?? 25,
					sortBy: sort_by,
					sortOrder: sort_order,
				});

				const { roles, memberRoleIds, ownerId } = await getGuildPermContext(guild_id);
				if (ownerId !== userId) {
					const uniqueChannelIds = [...new Set(result.messages.map((g) => g[0]?.channel_id).filter(Boolean))] as string[];
					const channelInfos = await Promise.all(uniqueChannelIds.map((id) => getChannel(botToken, id)));
					const visibleChannels = new Set(
						channelInfos
							.filter((ch) => {
								const perms = computePermissions(guild_id, userId, memberRoleIds, roles, ch.permission_overwrites ?? []);
								return Boolean(perms & VIEW_CHANNEL);
							})
							.map((ch) => ch.id),
					);
					result.messages = result.messages.filter((group) => visibleChannels.has(group[0]?.channel_id));
					result.total_results = result.messages.length;
				}

				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(
								{
									total_results: result.total_results,
									messages: result.messages.map((group) =>
										group.map((m) => ({
											id: m.id,
											channel_id: m.channel_id,
											author: {
												id: m.author.id,
												username: m.author.username,
												global_name: m.author.global_name,
												bot: m.author.bot,
											},
											content: m.content,
											timestamp: m.timestamp,
										})),
									),
								},
								null,
								2,
							),
						},
					],
				};
			},
		);

		tool(
			"send_message",
			"Send a message to a Discord channel",
			{
				channel_id: z.string().describe("The Discord channel ID"),
				content: z
					.string()
					.max(2000)
					.describe("Message content (max 2000 characters)"),
			},
			async ({ channel_id, content }, audit) => {
				await assertChannelAccess(channel_id);
				const msg = await sendMessage(botToken, channel_id, content, [attributionEmbed]);
				audit.messageId = msg.id;
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(
								{
									id: msg.id,
									channel_id: msg.channel_id,
									content: msg.content,
									timestamp: msg.timestamp,
								},
								null,
								2,
							),
						},
					],
				};
			},
		);

		tool(
			"reply_to_message",
			"Reply to a specific message in a Discord channel",
			{
				channel_id: z.string().describe("The Discord channel ID"),
				message_id: z.string().describe("The message ID to reply to"),
				content: z
					.string()
					.max(2000)
					.describe("Reply content (max 2000 characters)"),
			},
			async ({ channel_id, message_id, content }, audit) => {
				await assertChannelAccess(channel_id);
				const msg = await replyToMessage(botToken, channel_id, message_id, content, [attributionEmbed]);
				audit.messageId = msg.id;
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(
								{
									id: msg.id,
									channel_id: msg.channel_id,
									content: msg.content,
									timestamp: msg.timestamp,
									reply_to: message_id,
								},
								null,
								2,
							),
						},
					],
				};
			},
		);
	}
}

// 5-minute buffer: trigger re-auth before the token actually expires
// so that in-flight tool calls don't fail mid-execution.
const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;

const mcpHandler = GuildBridgeMCP.serve("/mcp");

const apiHandlerWithExpiryCheck = {
	async fetch<E>(request: Request, env: E, ctx: ExecutionContext) {
		const props = (ctx as unknown as { props?: Props }).props;
		if (props?.expiresAt && props.expiresAt < Date.now() + TOKEN_EXPIRY_BUFFER_MS) {
			return new Response("Unauthorized", {
				status: 401,
				headers: {
					"WWW-Authenticate": `Bearer error="invalid_token", error_description="Discord token expired"`,
				},
			});
		}
		return mcpHandler.fetch(request, env, ctx);
	},
};

const provider = new OAuthProvider({
	apiHandler: apiHandlerWithExpiryCheck,
	apiRoute: "/mcp",
	authorizeEndpoint: "/authorize",
	tokenEndpoint: "/token",
	clientRegistrationEndpoint: "/register",
	defaultHandler: DiscordHandler as any,
});

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const response = await provider.fetch(request, env, ctx);

		if (response.status === 401) {
			const origin = new URL(request.url).origin;
			const existingWwwAuth = response.headers.get("WWW-Authenticate");
			if (existingWwwAuth && existingWwwAuth.toLowerCase().startsWith("bearer")) {
				const newResponse = new Response(response.clone().body, response);
				newResponse.headers.set(
					"WWW-Authenticate",
					`${existingWwwAuth}, resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
				);
				return newResponse;
			}
		}

		return response;
	},
};
