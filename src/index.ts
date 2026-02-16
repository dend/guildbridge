import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";
import { DiscordHandler } from "./discord-handler";
import {
	listBotGuilds,
	listChannels,
	getChannel,
	readMessages,
	sendMessage,
	replyToMessage,
	searchMessages,
	CHANNEL_TYPE_NAMES,
} from "./discord-api";
import type { Props } from "./utils";

export class GuildBridgeMCP extends McpAgent<Env, Record<string, never>, Props> {
	server = new McpServer({
		name: "Guildbridge",
		version: "1.0.0",
	});

	async init() {
		const botToken = this.env.DISCORD_BOT_TOKEN;

		this.server.tool("list_guilds", "List Discord servers the bot is in", {}, async () => {
			const guilds = await listBotGuilds(botToken);
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

		this.server.tool(
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
				const channels = await listChannels(botToken, guild_id);
				let filtered = channels;
				if (type) {
					const typeEntry = Object.entries(CHANNEL_TYPE_NAMES).find(
						([, name]) => name === type.toLowerCase(),
					);
					if (typeEntry) {
						const typeNum = parseInt(typeEntry[0]);
						filtered = channels.filter((ch) => ch.type === typeNum);
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

		this.server.tool(
			"get_channel_info",
			"Get details about a specific Discord channel",
			{
				channel_id: z.string().describe("The Discord channel ID"),
			},
			async ({ channel_id }) => {
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

		this.server.tool(
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

		this.server.tool(
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
				const result = await searchMessages(botToken, guild_id, query, {
					channelId: channel_id,
					authorId: author_id,
					limit: limit ?? 25,
					sortBy: sort_by,
					sortOrder: sort_order,
				});
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

		this.server.tool(
			"send_message",
			"Send a message to a Discord channel",
			{
				channel_id: z.string().describe("The Discord channel ID"),
				content: z
					.string()
					.max(2000)
					.describe("Message content (max 2000 characters)"),
			},
			async ({ channel_id, content }) => {
				const msg = await sendMessage(botToken, channel_id, content);
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

		this.server.tool(
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
			async ({ channel_id, message_id, content }) => {
				const msg = await replyToMessage(botToken, channel_id, message_id, content);
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

export default new OAuthProvider({
	apiHandler: GuildBridgeMCP.serve("/mcp"),
	apiRoute: "/mcp",
	authorizeEndpoint: "/authorize",
	tokenEndpoint: "/token",
	clientRegistrationEndpoint: "/register",
	defaultHandler: DiscordHandler as any,
});
