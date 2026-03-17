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

const app = new Hono<{
	Bindings: Env;
	Variables: { cfAccessEmail: string };
}>();

app.use("*", cfAccessMiddleware);

app.get("/", (c) => {
	const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
	const adminEmail = escapeHtml(c.get("cfAccessEmail"));
	const html = `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>GuildBridge Admin</title>
	<script>
		try {
			if (localStorage.getItem("admin-theme") === "dark") document.documentElement.classList.add("dark");
		} catch (e) {}
	</script>
	<style>
		:root {
			--background: hsl(0 0% 100%);
			--foreground: hsl(240 10% 3.9%);
			--card: hsl(0 0% 100%);
			--card-foreground: hsl(240 10% 3.9%);
			--muted: hsl(240 4.8% 95.9%);
			--muted-foreground: hsl(240 3.8% 46.1%);
			--border: hsl(240 5.9% 90%);
			--input: hsl(240 5.9% 90%);
			--primary: hsl(240 5.9% 10%);
			--primary-foreground: hsl(0 0% 98%);
			--destructive: hsl(0 72.2% 50.6%);
			--destructive-foreground: hsl(0 0% 98%);
			--ring: hsl(240 5% 64.9%);
			--hover: hsl(240 4.8% 95.9% / 0.5);
			--status-error-bg: hsl(0 86% 97%);
			--status-error-fg: hsl(0 74% 42%);
			--status-error-border: hsl(0 93% 94%);
			--status-success-bg: hsl(143 85% 96%);
			--status-success-fg: hsl(140 100% 27%);
			--status-success-border: hsl(145 92% 91%);
			--radius: 0.375rem;
			--font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		}
		:root.dark {
			--background: hsl(240 10% 3.9%);
			--foreground: hsl(0 0% 98%);
			--card: hsl(240 10% 3.9%);
			--card-foreground: hsl(0 0% 98%);
			--muted: hsl(240 3.7% 15.9%);
			--muted-foreground: hsl(240 5% 64.9%);
			--border: hsl(240 3.7% 15.9%);
			--input: hsl(240 3.7% 15.9%);
			--primary: hsl(0 0% 98%);
			--primary-foreground: hsl(240 5.9% 10%);
			--destructive: hsl(0 62.8% 30.6%);
			--destructive-foreground: hsl(0 0% 98%);
			--ring: hsl(240 4.9% 83.9%);
			--hover: hsl(240 3.7% 15.9% / 0.5);
			--status-error-bg: hsl(0 63% 18%);
			--status-error-fg: hsl(0 91% 71%);
			--status-error-border: hsl(0 63% 25%);
			--status-success-bg: hsl(144 61% 13%);
			--status-success-fg: hsl(142 71% 58%);
			--status-success-border: hsl(144 61% 20%);
			color-scheme: dark;
		}
		* { box-sizing: border-box; }
		html, body { height: 100%; }
		body {
			font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
			font-size: 13px;
			line-height: 1.5;
			color: var(--foreground);
			background-color: var(--background);
			margin: 0;
			-webkit-font-smoothing: antialiased;
			font-feature-settings: "rlig" 1, "calt" 1;
			display: flex;
			flex-direction: column;
		}

		/* Spanning header */
		.topbar {
			height: 3rem;
			flex-shrink: 0;
			border-bottom: 1px solid var(--border);
			padding: 0 1rem;
			display: flex;
			align-items: center;
			justify-content: space-between;
		}
		.topbar-title { font-size: 0.9375rem; font-weight: 600; letter-spacing: -0.025em; }
		.topbar-user { font-size: 0.8125rem; color: var(--muted-foreground); }

		/* Sidebar + content layout */
		.layout { flex: 1; display: flex; min-height: 0; }
		.sidebar {
			width: 11rem;
			flex-shrink: 0;
			border-right: 1px solid var(--border);
			padding: 0.5rem;
			display: flex;
			flex-direction: column;
			gap: 0.125rem;
		}
		.nav-item {
			display: block;
			padding: 0.375rem 0.625rem;
			border-radius: calc(var(--radius) - 2px);
			font-size: 0.875rem;
			font-weight: 500;
			color: var(--foreground);
			text-decoration: none;
			cursor: pointer;
			transition: background-color 0.15s;
		}
		.nav-item:hover { background-color: var(--muted); }
		.nav-item.active { background-color: var(--muted); }
		.content { flex: 1; overflow-y: auto; padding: 1rem 1.25rem; }

		/* Panel sections */
		.panel { display: none; max-width: 48rem; }
		.panel.active { display: block; }
		.panel-header { margin-bottom: 1rem; }
		.panel-header h2 { margin: 0; font-size: 1rem; font-weight: 600; letter-spacing: -0.025em; }
		.panel-header p { margin: 0.25rem 0 0; font-size: 0.875rem; color: var(--muted-foreground); }
		.section { margin-bottom: 1rem; }
		.section-label { display: block; font-size: 0.875rem; font-weight: 500; margin-bottom: 0.375rem; }

		/* Card (data table wrapper) */
		.card {
			background-color: var(--card);
			color: var(--card-foreground);
			border: 1px solid var(--border);
			border-radius: var(--radius);
			box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05);
			overflow: hidden;
		}

		/* Form controls */
		.add-form { display: flex; gap: 0.5rem; max-width: 32rem; }
		.add-form input {
			flex: 1;
			height: 2rem;
			padding: 0 0.75rem;
			border: 1px solid var(--input);
			border-radius: calc(var(--radius) - 2px);
			background: transparent;
			color: var(--foreground);
			font-size: 0.875rem;
			font-family: var(--font-mono);
			transition: border-color 0.15s, box-shadow 0.15s;
		}
		.add-form input::placeholder { color: var(--muted-foreground); }
		.add-form input:focus-visible { outline: none; border-color: var(--ring); box-shadow: 0 0 0 1px var(--ring); }
		.filter-row { display: flex; gap: 0.5rem; max-width: 32rem; }
		.filter-row input, .filter-row select {
			height: 2rem;
			padding: 0 0.75rem;
			border: 1px solid var(--input);
			border-radius: calc(var(--radius) - 2px);
			background: var(--background);
			color: var(--foreground);
			font-size: 0.875rem;
			transition: border-color 0.15s, box-shadow 0.15s;
		}
		.filter-row input { flex: 1; font-family: var(--font-mono); }
		.filter-row input::placeholder { color: var(--muted-foreground); }
		.filter-row select:focus-visible, .filter-row input:focus-visible { outline: none; border-color: var(--ring); box-shadow: 0 0 0 1px var(--ring); }
		tr.outcome-error td { color: var(--destructive); }
		.button {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			height: 2rem;
			padding: 0 0.75rem;
			border-radius: calc(var(--radius) - 2px);
			font-size: 0.875rem;
			font-weight: 500;
			cursor: pointer;
			border: none;
			transition: background-color 0.15s, opacity 0.15s;
			white-space: nowrap;
		}
		.button:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--background), 0 0 0 4px var(--ring); }
		.button-primary { background-color: var(--primary); color: var(--primary-foreground); }
		.button-primary:hover { opacity: 0.9; }
		.button-primary:disabled { opacity: 0.5; cursor: not-allowed; }
		.button-danger { background-color: var(--destructive); color: var(--destructive-foreground); height: 1.75rem; padding: 0 0.75rem; font-size: 0.75rem; }
		.button-danger:hover { opacity: 0.9; }
		.button-ghost { background: transparent; color: var(--muted-foreground); height: 1.75rem; padding: 0 0.5rem; font-size: 0.75rem; }
		.button-ghost:hover { background: var(--muted); color: var(--foreground); }

		/* User cell (allowlist) */
		.user-cell { display: flex; align-items: center; gap: 0.625rem; }
		.user-cell > div:last-child { line-height: 1.25; min-width: 0; }
		.avatar { width: 2rem; height: 2rem; border-radius: 9999px; background: var(--muted); color: var(--muted-foreground); display: inline-flex; align-items: center; justify-content: center; font-weight: 500; flex-shrink: 0; text-transform: uppercase; }
		.user-name { font-weight: 500; }
		.user-sub { color: var(--muted-foreground); font-family: var(--font-mono); margin-top: 0.125rem; }

		/* Table */
		table { width: 100%; border-collapse: collapse; font-size: 0.8125rem; }
		thead tr { border-bottom: 1px solid var(--border); }
		th { height: 2rem; padding: 0 0.5rem; text-align: left; vertical-align: middle; white-space: nowrap; font-weight: 500; font-size: 0.75rem; color: var(--muted-foreground); }
		tbody tr { border-bottom: 1px solid var(--border); transition: background-color 0.15s; }
		tbody tr:last-child { border-bottom: none; }
		tbody tr:hover { background-color: var(--hover); }
		td { padding: 0.375rem 0.5rem; vertical-align: middle; }
		td.mono { font-family: var(--font-mono); font-size: 0.8125rem; color: var(--muted-foreground); }
		td.muted { color: var(--muted-foreground); }
		td.actions { text-align: right; width: 1%; }
		.empty { text-align: center; color: var(--muted-foreground); padding: 1rem 0; font-size: 0.875rem; }

		/* Status */
		.status { padding: 0.5rem 0.75rem; border-radius: calc(var(--radius) - 2px); margin-top: 0.75rem; font-size: 0.8125rem; display: none; border: 1px solid; max-width: 32rem; }
		.status.error { display: block; background: var(--status-error-bg); color: var(--status-error-fg); border-color: var(--status-error-border); }
		.status.success { display: block; background: var(--status-success-bg); color: var(--status-success-fg); border-color: var(--status-success-border); }

		/* Theme toggle (segmented control) */
		.theme-toggle { display: inline-flex; padding: 0.1875rem; background: var(--muted); border-radius: var(--radius); gap: 0; }
		.theme-toggle button {
			border: none;
			background: transparent;
			color: var(--muted-foreground);
			font-size: 0.8125rem;
			font-weight: 500;
			padding: 0.3125rem 0.875rem;
			border-radius: calc(var(--radius) - 2px);
			cursor: pointer;
			transition: background-color 0.15s, color 0.15s;
		}
		.theme-toggle button:hover { color: var(--foreground); }
		.theme-toggle button.active { background: var(--background); color: var(--foreground); box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05); }
	</style>
</head>
<body>
	<header class="topbar">
		<div class="topbar-title">GuildBridge Admin</div>
		<div class="topbar-user">${adminEmail}</div>
	</header>
	<div class="layout">
		<nav class="sidebar">
			<a class="nav-item active" data-tab="allowlist">Allowlist</a>
			<a class="nav-item" data-tab="activity">Activity</a>
			<a class="nav-item" data-tab="settings">Settings</a>
		</nav>
		<main class="content">
			<div class="panel active" data-panel="allowlist">
				<div class="panel-header">
					<h2>Allowlist</h2>
					<p>Manage which Discord users can authenticate with GuildBridge.</p>
				</div>
				<div class="section">
					<label class="section-label" for="userId">Add user</label>
					<div class="add-form">
						<input type="text" id="userId" placeholder="Discord User ID" />
						<button class="button button-primary" id="addBtn" onclick="addUser()">Add</button>
					</div>
					<div id="addStatus" class="status"></div>
				</div>
				<div class="card">
					<table>
						<thead><tr><th>User</th><th>Added</th><th></th></tr></thead>
						<tbody id="userList"></tbody>
					</table>
				</div>
			</div>
			<div class="panel" data-panel="activity">
				<div class="panel-header">
					<h2>Activity</h2>
					<p>Recent MCP tool invocations across all users.</p>
				</div>
				<div class="section">
					<div class="filter-row">
						<select id="filterTool">
							<option value="">All tools</option>
							<option>list_guilds</option>
							<option>list_channels</option>
							<option>get_channel_info</option>
							<option>read_messages</option>
							<option>search_messages</option>
							<option>send_message</option>
							<option>reply_to_message</option>
						</select>
						<input type="text" id="filterUser" placeholder="Filter by user ID" />
						<button class="button button-primary" onclick="loadAudit()">Filter</button>
					</div>
				</div>
				<div class="card">
					<table>
						<thead><tr><th>Time</th><th>User</th><th>Tool</th><th>Target</th><th>Duration</th><th>Outcome</th></tr></thead>
						<tbody id="auditList"></tbody>
					</table>
				</div>
			</div>
			<div class="panel" data-panel="settings">
				<div class="panel-header">
					<h2>Settings</h2>
					<p>Preferences for this admin panel.</p>
				</div>
				<div class="section">
					<label class="section-label">Theme</label>
					<div class="theme-toggle" id="themeToggle">
						<button type="button" data-theme="light">Light</button>
						<button type="button" data-theme="dark">Dark</button>
					</div>
				</div>
			</div>
		</main>
	</div>
	<script>
		function getStoredTheme() { try { return localStorage.getItem("admin-theme"); } catch (e) { return null; } }
		function setTheme(theme) {
			document.documentElement.classList.toggle("dark", theme === "dark");
			try { localStorage.setItem("admin-theme", theme); } catch (e) {}
			document.querySelectorAll("#themeToggle button").forEach(function (b) {
				b.classList.toggle("active", b.dataset.theme === theme);
			});
		}
		document.querySelectorAll("#themeToggle button").forEach(function (b) {
			b.addEventListener("click", function () { setTheme(b.dataset.theme); });
		});

		document.querySelectorAll(".nav-item").forEach(function (el) {
			el.addEventListener("click", function () {
				var tab = el.dataset.tab;
				document.querySelectorAll(".nav-item").forEach(function (n) { n.classList.toggle("active", n === el); });
				document.querySelectorAll(".panel").forEach(function (p) { p.classList.toggle("active", p.dataset.panel === tab); });
				if (tab === "activity") loadAudit();
			});
		});
		async function loadUsers() {
			const el = document.getElementById("userList");
			try {
				const resp = await fetch("/admin/api/users");
				const data = await resp.json();
				let html = "";
				for (const u of (data.users || [])) {
					const name = u.global_name || u.username || u.id;
					const date = u.added_at ? new Date(u.added_at).toLocaleDateString() : "—";
					const sub = (u.username ? "@" + esc(u.username) + " &middot; " : "") + esc(u.id);
					html += "<tr>";
					html += "<td><div class='user-cell'><div class='avatar'>" + esc(name.charAt(0)) + "</div><div><div class='user-name'>" + esc(name) + "</div><div class='user-sub'>" + sub + "</div></div></div></td>";
					html += '<td class="muted">' + esc(date) + "</td>";
					html += '<td class="actions"><button class="button button-ghost" onclick="removeUser(\\'' + esc(u.id) + "')\\">Remove</button></td>";
					html += "</tr>";
				}
				el.innerHTML = html;
			} catch (e) {
				el.innerHTML = '<tr><td colspan="3" class="empty">Failed to load users</td></tr>';
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
		async function loadAudit() {
			const el = document.getElementById("auditList");
			const tool = document.getElementById("filterTool").value;
			const userId = document.getElementById("filterUser").value.trim();
			const params = new URLSearchParams({ limit: "50" });
			if (tool) params.set("tool", tool);
			if (userId) params.set("user_id", userId);
			try {
				const resp = await fetch("/admin/api/audit?" + params.toString());
				const data = await resp.json();
				let html = "";
				for (const e of (data.events || [])) {
					const time = new Date(e.ts).toLocaleString();
					const target = e.channel_id ? "ch " + e.channel_id : (e.guild_id ? "guild " + e.guild_id : "—");
					const outcome = e.outcome === "error" ? (e.error ? esc(e.error.slice(0, 60)) : "error") : "ok";
					const rowCls = e.outcome === "error" ? ' class="outcome-error"' : "";
					html += "<tr" + rowCls + ">";
					html += "<td>" + esc(time) + "</td>";
					html += "<td>" + esc(e.username || e.user_id) + "</td>";
					html += "<td>" + esc(e.tool) + "</td>";
					html += '<td class="mono">' + esc(target) + "</td>";
					html += "<td>" + e.duration_ms + "ms</td>";
					html += "<td>" + outcome + "</td>";
					html += "</tr>";
				}
				el.innerHTML = html;
			} catch (err) {
				el.innerHTML = '<tr><td colspan="6" class="empty">Failed to load activity</td></tr>';
			}
		}
		document.getElementById("userId").addEventListener("keydown", function(e) {
			if (e.key === "Enter") addUser();
		});
		document.getElementById("filterUser").addEventListener("keydown", function(e) {
			if (e.key === "Enter") loadAudit();
		});
		document.getElementById("filterTool").addEventListener("change", loadAudit);
		setTheme(getStoredTheme() || "light");
		loadUsers();
	</script>
</body>
</html>`;
	return c.html(html);
});

app.get("/api/users", async (c) => {
	const allowlistRaw = await c.env.OAUTH_KV.get("admin:allowlist");
	const ids: string[] = allowlistRaw ? JSON.parse(allowlistRaw) : [];

	const users: AdminUser[] = [];
	const metaResults = await Promise.all(
		ids.map((id) => c.env.OAUTH_KV.get(`admin:user:${id}`)),
	);
	for (let i = 0; i < ids.length; i++) {
		if (metaResults[i]) {
			users.push(JSON.parse(metaResults[i]!) as AdminUser);
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

	// Check if already in list
	const allowlistRaw = await c.env.OAUTH_KV.get("admin:allowlist");
	const ids: string[] = allowlistRaw ? JSON.parse(allowlistRaw) : [];
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

	ids.push(discordId);
	await Promise.all([
		c.env.OAUTH_KV.put("admin:allowlist", JSON.stringify(ids)),
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
	const ids: string[] = allowlistRaw ? JSON.parse(allowlistRaw) : [];
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

app.get("/api/audit", async (c) => {
	const limit = Math.min(Number(c.req.query("limit")) || 50, 200);
	const userId = c.req.query("user_id");
	const tool = c.req.query("tool");

	const clauses: string[] = [];
	const binds: (string | number)[] = [];
	if (userId) {
		clauses.push("user_id = ?");
		binds.push(userId);
	}
	if (tool) {
		clauses.push("tool = ?");
		binds.push(tool);
	}
	const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

	const { results } = await c.env.AUDIT_DB.prepare(
		`SELECT ts, tool, user_id, username, outcome, duration_ms, guild_id, channel_id, message_id, error FROM audit_log ${where} ORDER BY ts DESC LIMIT ?`,
	)
		.bind(...binds, limit)
		.all();

	return c.json({ events: results });
});

export { app as adminApp };
