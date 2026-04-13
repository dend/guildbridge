// Admin panel for managing the user allowlist

import { Hono } from "hono";
import { cfAccessMiddleware } from "./cf-access";
import { getUser } from "./discord-api";

interface AdminUser {
	id: string;
	username: string;
	global_name: string | null;
	added_at: string;
	added_by: string;
}

function safeParseAllowlist(raw: string | null): string[] {
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		console.error("Malformed allowlist in KV, treating as empty");
		return [];
	}
}

const app = new Hono<{
	Bindings: Env;
	Variables: { cfAccessEmail: string };
}>();

app.use("*", cfAccessMiddleware);

app.get("/", (c) => {
	const html = `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>GuildBridge Admin</title>
	<style>
		:root {
			--primary-color: #5865F2;
			--primary-hover: #4752C4;
			--danger-color: #ED4245;
			--danger-hover: #C03537;
			--border-color: #e5e7eb;
			--text-color: #333;
			--background-color: #fff;
			--card-shadow: 0 8px 36px 8px rgba(0, 0, 0, 0.1);
		}
		body {
			font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
						 Helvetica, Arial, sans-serif;
			line-height: 1.6;
			color: var(--text-color);
			background-color: #f9fafb;
			margin: 0;
			padding: 0;
		}
		.container { max-width: 700px; margin: 2rem auto; padding: 1rem; }
		.header { text-align: center; margin-bottom: 2rem; }
		.header h1 { font-size: 1.5rem; color: var(--primary-color); margin: 0; }
		.header p { color: #666; margin: 0.25rem 0 0; font-size: 0.9rem; }
		.card {
			background-color: var(--background-color);
			border-radius: 8px;
			box-shadow: var(--card-shadow);
			padding: 1.5rem;
			margin-bottom: 1.5rem;
		}
		.card h2 { margin: 0 0 1rem; font-size: 1.1rem; }
		.add-form { display: flex; gap: 0.5rem; }
		.add-form input {
			flex: 1;
			padding: 0.5rem 0.75rem;
			border: 1px solid var(--border-color);
			border-radius: 6px;
			font-size: 0.95rem;
			font-family: SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		}
		.button {
			padding: 0.5rem 1rem;
			border-radius: 6px;
			font-weight: 500;
			cursor: pointer;
			border: none;
			font-size: 0.9rem;
			color: white;
		}
		.button-primary { background-color: var(--primary-color); }
		.button-primary:hover { background-color: var(--primary-hover); }
		.button-primary:disabled { opacity: 0.6; cursor: not-allowed; }
		.button-danger { background-color: var(--danger-color); padding: 0.3rem 0.6rem; font-size: 0.8rem; }
		.button-danger:hover { background-color: var(--danger-hover); }
		table { width: 100%; border-collapse: collapse; }
		th { text-align: left; padding: 0.5rem; border-bottom: 2px solid var(--border-color); font-size: 0.85rem; color: #666; }
		td { padding: 0.5rem; border-bottom: 1px solid var(--border-color); font-size: 0.9rem; }
		td.mono { font-family: SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 0.85rem; }
		.empty { text-align: center; color: #999; padding: 2rem 0; }
		.status { padding: 0.5rem 0.75rem; border-radius: 6px; margin-top: 0.75rem; font-size: 0.85rem; display: none; }
		.status.error { display: block; background: #FEE2E2; color: #991B1B; }
		.status.success { display: block; background: #D1FAE5; color: #065F46; }
	</style>
</head>
<body>
	<div class="container">
		<div class="header">
			<h1>GuildBridge Admin</h1>
			<p>Manage allowed Discord users</p>
		</div>
		<div class="card">
			<h2>Add User</h2>
			<div class="add-form">
				<input type="text" id="userId" placeholder="Discord User ID" />
				<button class="button button-primary" id="addBtn" onclick="addUser()">Add</button>
			</div>
			<div id="addStatus" class="status"></div>
		</div>
		<div class="card">
			<h2>Allowed Users</h2>
			<div id="userList"></div>
		</div>
	</div>
	<script>
		async function loadUsers() {
			const el = document.getElementById("userList");
			try {
				const resp = await fetch("/admin/api/users");
				const data = await resp.json();
				if (!data.users || data.users.length === 0) {
					el.innerHTML = '<div class="empty">No users in allowlist</div>';
					return;
				}
				let html = "<table><thead><tr><th>User</th><th>ID</th><th>Added</th><th></th></tr></thead><tbody>";
				for (const u of data.users) {
					const name = u.global_name || u.username || u.id;
					const date = u.added_at ? new Date(u.added_at).toLocaleDateString() : "—";
					html += "<tr>";
					html += "<td>" + esc(name) + (u.username ? " <span style='color:#999'>(" + esc(u.username) + ")</span>" : "") + "</td>";
					html += '<td class="mono">' + esc(u.id) + "</td>";
					html += "<td>" + esc(date) + "</td>";
					html += '<td><button class="button button-danger" onclick="removeUser(\'' + esc(u.id) + "')\">Remove</button></td>";
					html += "</tr>";
				}
				html += "</tbody></table>";
				el.innerHTML = html;
			} catch (e) {
				el.innerHTML = '<div class="empty">Failed to load users</div>';
			}
		}
		async function addUser() {
			const input = document.getElementById("userId");
			const status = document.getElementById("addStatus");
			const btn = document.getElementById("addBtn");
			const discordId = input.value.trim();
			if (!discordId) return;
			btn.disabled = true;
			status.className = "status";
			status.style.display = "none";
			try {
				const resp = await fetch("/admin/api/users", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ discord_id: discordId }),
				});
				const data = await resp.json();
				if (!resp.ok) {
					status.textContent = data.error || "Failed to add user";
					status.className = "status error";
					return;
				}
				status.textContent = "Added " + (data.user.global_name || data.user.username || discordId);
				status.className = "status success";
				input.value = "";
				loadUsers();
			} catch (e) {
				status.textContent = "Request failed";
				status.className = "status error";
			} finally {
				btn.disabled = false;
			}
		}
		async function removeUser(id) {
			if (!confirm("Remove user " + id + " from the allowlist?")) return;
			try {
				const resp = await fetch("/admin/api/users/" + id, { method: "DELETE" });
				if (!resp.ok) {
					const data = await resp.json();
					alert(data.error || "Failed to remove user");
					return;
				}
				loadUsers();
			} catch (e) {
				alert("Request failed");
			}
		}
		function esc(s) {
			const d = document.createElement("div");
			d.textContent = s;
			return d.innerHTML;
		}
		document.getElementById("userId").addEventListener("keydown", function(e) {
			if (e.key === "Enter") addUser();
		});
		loadUsers();
	</script>
</body>
</html>`;
	return c.html(html);
});

app.get("/api/users", async (c) => {
	const allowlistRaw = await c.env.OAUTH_KV.get("admin:allowlist");
	const ids: string[] = safeParseAllowlist(allowlistRaw);

	const users: AdminUser[] = [];
	const metaResults = await Promise.all(
		ids.map((id) => c.env.OAUTH_KV.get(`admin:user:${id}`)),
	);
	for (let i = 0; i < ids.length; i++) {
		if (metaResults[i]) {
			try {
				users.push(JSON.parse(metaResults[i]!) as AdminUser);
			} catch {
				users.push({ id: ids[i], username: "", global_name: null, added_at: "", added_by: "" });
			}
		} else {
			users.push({ id: ids[i], username: "", global_name: null, added_at: "", added_by: "" });
		}
	}

	return c.json({ users });
});

app.post("/api/users", async (c) => {
	const body = await c.req.json<{ discord_id?: string }>();
	const discordId = body.discord_id?.trim();
	if (!discordId || !/^\d+$/.test(discordId)) {
		return c.json({ error: "Invalid Discord user ID" }, 400);
	}

	// Early check before expensive Discord API call
	const allowlistRaw = await c.env.OAUTH_KV.get("admin:allowlist");
	const ids: string[] = safeParseAllowlist(allowlistRaw);
	if (ids.includes(discordId)) {
		return c.json({ error: "User already in allowlist" }, 409);
	}

	// Look up user via Discord API
	let discordUser: { id: string; username: string; global_name: string | null };
	try {
		discordUser = await getUser(c.env.DISCORD_BOT_TOKEN, discordId);
	} catch {
		return c.json({ error: "Discord user not found" }, 404);
	}

	const adminEmail = c.get("cfAccessEmail");
	const meta: AdminUser = {
		id: discordUser.id,
		username: discordUser.username,
		global_name: discordUser.global_name,
		added_at: new Date().toISOString(),
		added_by: adminEmail,
	};

	// Re-read allowlist after the Discord API call to minimize TOCTOU window
	const freshRaw = await c.env.OAUTH_KV.get("admin:allowlist");
	const freshIds: string[] = safeParseAllowlist(freshRaw);
	if (freshIds.includes(discordId)) {
		return c.json({ error: "User already in allowlist" }, 409);
	}

	freshIds.push(discordId);
	await Promise.all([
		c.env.OAUTH_KV.put("admin:allowlist", JSON.stringify(freshIds)),
		c.env.OAUTH_KV.put(`admin:user:${discordId}`, JSON.stringify(meta)),
	]);

	return c.json({ user: meta }, 201);
});

app.delete("/api/users/:id", async (c) => {
	const targetId = c.req.param("id");
	if (!targetId || !/^\d+$/.test(targetId)) {
		return c.json({ error: "Invalid user ID" }, 400);
	}

	const allowlistRaw = await c.env.OAUTH_KV.get("admin:allowlist");
	const ids: string[] = safeParseAllowlist(allowlistRaw);
	const filtered = ids.filter((id) => id !== targetId);

	if (filtered.length === ids.length) {
		return c.json({ error: "User not in allowlist" }, 404);
	}

	await Promise.all([
		c.env.OAUTH_KV.put("admin:allowlist", JSON.stringify(filtered)),
		c.env.OAUTH_KV.delete(`admin:user:${targetId}`),
	]);

	return c.json({ ok: true });
});

export { app as adminApp };
