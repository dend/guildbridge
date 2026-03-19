// Discord REST API helpers + types

const DISCORD_API_BASE = "https://discord.com/api/v10";

export interface DiscordGuild {
	id: string;
	name: string;
	icon: string | null;
	owner_id?: string;
	member_count?: number;
}

export interface DiscordRole {
	id: string;
	name: string;
	permissions: string; // bigint as string
}

export interface DiscordPermissionOverwrite {
	id: string; // role or user ID
	type: number; // 0 = role, 1 = member
	allow: string; // bigint as string
	deny: string; // bigint as string
}

export interface DiscordGuildMember {
	roles: string[]; // array of role IDs
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
	permission_overwrites?: DiscordPermissionOverwrite[];
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
	author?: { name: string; icon_url?: string };
	footer?: { text: string };
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
	embeds?: DiscordEmbed[],
): Promise<DiscordMessage> {
	return discordFetch<DiscordMessage>(token, `/channels/${channelId}/messages`, {
		method: "POST",
		body: JSON.stringify({ content, ...(embeds && { embeds }) }),
	});
}

export async function replyToMessage(
	token: string,
	channelId: string,
	messageId: string,
	content: string,
	embeds?: DiscordEmbed[],
): Promise<DiscordMessage> {
	return discordFetch<DiscordMessage>(token, `/channels/${channelId}/messages`, {
		method: "POST",
		body: JSON.stringify({
			content,
			message_reference: { message_id: messageId },
			...(embeds && { embeds }),
		}),
	});
}

export async function getUser(token: string, userId: string): Promise<DiscordUser> {
	return discordFetch<DiscordUser>(token, `/users/${userId}`);
}

export async function getGuildMember(
	token: string,
	guildId: string,
	userId: string,
): Promise<DiscordGuildMember> {
	return discordFetch<DiscordGuildMember>(token, `/guilds/${guildId}/members/${userId}`);
}

export async function getGuildRoles(token: string, guildId: string): Promise<DiscordRole[]> {
	return discordFetch<DiscordRole[]>(token, `/guilds/${guildId}/roles`);
}

export const VIEW_CHANNEL = 1n << 10n;
const ADMINISTRATOR = 1n << 3n;

export function computePermissions(
	guildId: string,
	memberId: string,
	memberRoleIds: string[],
	roles: DiscordRole[],
	overwrites: DiscordPermissionOverwrite[],
): bigint {
	const roleMap = new Map(roles.map((r) => [r.id, r]));

	// 1. Base = @everyone role permissions (role ID == guild ID)
	const everyoneRole = roleMap.get(guildId);
	let permissions = everyoneRole ? BigInt(everyoneRole.permissions) : 0n;

	// 2. OR in permissions for each of the member's roles
	for (const roleId of memberRoleIds) {
		const role = roleMap.get(roleId);
		if (role) {
			permissions |= BigInt(role.permissions);
		}
	}

	// 3. If ADMINISTRATOR bit set, return all permissions
	if (permissions & ADMINISTRATOR) {
		return ~0n;
	}

	// 4. Apply channel @everyone overwrite (deny then allow)
	const everyoneOverwrite = overwrites.find((o) => o.id === guildId);
	if (everyoneOverwrite) {
		permissions &= ~BigInt(everyoneOverwrite.deny);
		permissions |= BigInt(everyoneOverwrite.allow);
	}

	// 5. OR together all role overwrites matching member's roles (deny then allow)
	let roleDeny = 0n;
	let roleAllow = 0n;
	for (const overwrite of overwrites) {
		if (overwrite.type === 0 && overwrite.id !== guildId && memberRoleIds.includes(overwrite.id)) {
			roleDeny |= BigInt(overwrite.deny);
			roleAllow |= BigInt(overwrite.allow);
		}
	}
	permissions &= ~roleDeny;
	permissions |= roleAllow;

	// 6. Apply member-specific overwrite (deny then allow)
	const memberOverwrite = overwrites.find((o) => o.type === 1 && o.id === memberId);
	if (memberOverwrite) {
		permissions &= ~BigInt(memberOverwrite.deny);
		permissions |= BigInt(memberOverwrite.allow);
	}

	return permissions;
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
