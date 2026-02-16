// Discord REST API helpers + types

const DISCORD_API_BASE = "https://discord.com/api/v10";

export interface DiscordGuild {
	id: string;
	name: string;
	icon: string | null;
	owner_id?: string;
	member_count?: number;
}

export interface DiscordChannel {
	id: string;
	guild_id?: string;
	name?: string;
	type: number;
	topic?: string | null;
	position?: number;
	parent_id?: string | null;
	nsfw?: boolean;
}

export interface DiscordUser {
	id: string;
	username: string;
	global_name: string | null;
	avatar: string | null;
	discriminator: string;
	bot?: boolean;
}

export interface DiscordAttachment {
	id: string;
	filename: string;
	url: string;
	size: number;
	content_type?: string;
}

export interface DiscordEmbed {
	title?: string;
	description?: string;
	url?: string;
	type?: string;
}

export interface DiscordMessageReference {
	message_id?: string;
	channel_id?: string;
	guild_id?: string;
}

export interface DiscordMessage {
	id: string;
	channel_id: string;
	author: DiscordUser;
	content: string;
	timestamp: string;
	edited_timestamp: string | null;
	attachments: DiscordAttachment[];
	embeds: DiscordEmbed[];
	message_reference?: DiscordMessageReference;
	referenced_message?: DiscordMessage | null;
	type: number;
}

export interface DiscordSearchResult {
	messages: DiscordMessage[][];
	total_results: number;
}

export const CHANNEL_TYPE_NAMES: Record<number, string> = {
	0: "text",
	1: "dm",
	2: "voice",
	3: "group_dm",
	4: "category",
	5: "announcement",
	10: "announcement_thread",
	11: "public_thread",
	12: "private_thread",
	13: "stage_voice",
	14: "directory",
	15: "forum",
	16: "media",
};

class DiscordApiError extends Error {
	constructor(
		public status: number,
		public body: string,
		public retryAfter?: number,
	) {
		super(`Discord API error ${status}: ${body}`);
		this.name = "DiscordApiError";
	}
}

async function discordFetch<T>(
	token: string,
	path: string,
	options: RequestInit = {},
): Promise<T> {
	const url = `${DISCORD_API_BASE}${path}`;
	const resp = await fetch(url, {
		...options,
		headers: {
			Authorization: `Bot ${token}`,
			"Content-Type": "application/json",
			...options.headers,
		},
	});

	if (resp.status === 429) {
		const retryAfter = resp.headers.get("Retry-After");
		throw new DiscordApiError(
			429,
			`Rate limited. Retry after ${retryAfter}s`,
			retryAfter ? parseFloat(retryAfter) : undefined,
		);
	}

	if (resp.status === 202) {
		throw new DiscordApiError(
			202,
			"Search is still being indexed. Try again shortly.",
		);
	}

	if (!resp.ok) {
		const body = await resp.text();
		throw new DiscordApiError(resp.status, body);
	}

	return resp.json() as Promise<T>;
}

export async function listBotGuilds(token: string): Promise<DiscordGuild[]> {
	return discordFetch<DiscordGuild[]>(token, "/users/@me/guilds");
}

export async function listUserGuilds(userAccessToken: string): Promise<DiscordGuild[]> {
	const resp = await fetch(`${DISCORD_API_BASE}/users/@me/guilds`, {
		headers: { Authorization: `Bearer ${userAccessToken}` },
	});
	if (!resp.ok) {
		throw new DiscordApiError(resp.status, await resp.text());
	}
	return resp.json() as Promise<DiscordGuild[]>;
}

export async function getGuild(token: string, guildId: string): Promise<DiscordGuild> {
	return discordFetch<DiscordGuild>(token, `/guilds/${guildId}?with_counts=true`);
}

export async function listChannels(token: string, guildId: string): Promise<DiscordChannel[]> {
	return discordFetch<DiscordChannel[]>(token, `/guilds/${guildId}/channels`);
}

export async function getChannel(token: string, channelId: string): Promise<DiscordChannel> {
	return discordFetch<DiscordChannel>(token, `/channels/${channelId}`);
}

export async function readMessages(
	token: string,
	channelId: string,
	opts: { limit?: number; before?: string; after?: string } = {},
): Promise<DiscordMessage[]> {
	const params = new URLSearchParams();
	if (opts.limit) params.set("limit", String(opts.limit));
	if (opts.before) params.set("before", opts.before);
	if (opts.after) params.set("after", opts.after);
	const query = params.toString();
	return discordFetch<DiscordMessage[]>(
		token,
		`/channels/${channelId}/messages${query ? `?${query}` : ""}`,
	);
}

export async function sendMessage(
	token: string,
	channelId: string,
	content: string,
): Promise<DiscordMessage> {
	return discordFetch<DiscordMessage>(token, `/channels/${channelId}/messages`, {
		method: "POST",
		body: JSON.stringify({ content }),
	});
}

export async function replyToMessage(
	token: string,
	channelId: string,
	messageId: string,
	content: string,
): Promise<DiscordMessage> {
	return discordFetch<DiscordMessage>(token, `/channels/${channelId}/messages`, {
		method: "POST",
		body: JSON.stringify({
			content,
			message_reference: { message_id: messageId },
		}),
	});
}

export async function searchMessages(
	token: string,
	guildId: string,
	query: string,
	opts: {
		channelId?: string;
		authorId?: string;
		limit?: number;
		sortBy?: string;
		sortOrder?: string;
	} = {},
): Promise<DiscordSearchResult> {
	const params = new URLSearchParams();
	params.set("content", query);
	if (opts.channelId) params.set("channel_id", opts.channelId);
	if (opts.authorId) params.set("author_id", opts.authorId);
	if (opts.limit) params.set("limit", String(opts.limit));
	if (opts.sortBy) params.set("sort_by", opts.sortBy);
	if (opts.sortOrder) params.set("sort_order", opts.sortOrder);
	return discordFetch<DiscordSearchResult>(
		token,
		`/guilds/${guildId}/messages/search?${params.toString()}`,
	);
}
