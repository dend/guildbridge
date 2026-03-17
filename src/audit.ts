// Tool-call audit: dual-write to D1 (admin-panel audit trail) and Analytics Engine (metrics)

export type AuditEvent = {
	tool: string;
	userId: string;
	username: string;
	outcome: "ok" | "error";
	durationMs: number;
	guildId?: string;
	channelId?: string;
	messageId?: string;
	error?: string;
};

// Mutable bag handlers write into before returning, so the wrapper can pick up
// result-side metadata (e.g. the Discord message ID created by send_message).
export type AuditContext = {
	messageId?: string;
};

export function recordAudit(
	env: Env,
	waitUntil: (p: Promise<unknown>) => void,
	ev: AuditEvent,
): void {
	waitUntil(
		env.AUDIT_DB.prepare(
			"INSERT INTO audit_log (ts, tool, user_id, username, outcome, duration_ms, guild_id, channel_id, message_id, error) VALUES (?,?,?,?,?,?,?,?,?,?)",
		)
			.bind(
				Date.now(),
				ev.tool,
				ev.userId,
				ev.username,
				ev.outcome,
				ev.durationMs,
				ev.guildId ?? null,
				ev.channelId ?? null,
				ev.messageId ?? null,
				ev.error ?? null,
			)
			.run()
			.catch((e) => console.error("audit: D1 write failed", e)),
	);

	// Analytics Engine — positional fields. indexes[0]=userId (WHERE filter).
	// blobs = [tool, username, outcome, guildId, channelId, messageId, error(trunc)]
	// doubles = [durationMs]
	env.TOOL_AUDIT.writeDataPoint({
		indexes: [ev.userId],
		blobs: [
			ev.tool,
			ev.username,
			ev.outcome,
			ev.guildId ?? "",
			ev.channelId ?? "",
			ev.messageId ?? "",
			(ev.error ?? "").slice(0, 256),
		],
		doubles: [ev.durationMs],
	});
}

export function extractResourceIds(args: unknown): {
	guildId?: string;
	channelId?: string;
} {
	const a = args as Record<string, unknown> | undefined;
	return {
		guildId: typeof a?.guild_id === "string" ? a.guild_id : undefined,
		channelId: typeof a?.channel_id === "string" ? a.channel_id : undefined,
	};
}
