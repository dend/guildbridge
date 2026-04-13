// Admin panel for managing the user allowlist

import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { Hono } from "hono";
import { cfAccessMiddleware } from "./cf-access";
import { getUser, getChannel, listBotGuilds } from "./discord-api";

interface AdminUser {
	id: string;
	username: string;
	global_name: string | null;
	added_at: string;
	added_by: string;
}

const ALLOWLIST_KEY = "admin:allowlist";

async function getAllowlist(kv: KVNamespace): Promise<string[]> {
	const raw = await kv.get(ALLOWLIST_KEY);
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		console.error("Malformed allowlist in KV, treating as empty");
		return [];
	}
}

// Single source of truth for the OAuth callback's user gate. Fail-closed:
// an empty allowlist rejects everyone. Seed via /admin before first use.
export async function isUserAllowed(kv: KVNamespace, userId: string): Promise<boolean> {
	const ids = await getAllowlist(kv);
	return ids.includes(userId);
}

// Module-level name caches for audit enrichment. Survive warm isolates.
type CacheEntry<T> = { value: T; expires: number };
const NAME_CACHE_TTL_MS = 60_000;
const guildNameCache = new Map<string, CacheEntry<string>>();
const channelCache = new Map<string, CacheEntry<{ name: string; guild_id: string }>>();

function readCache<T>(cache: Map<string, CacheEntry<T>>, key: string): T | undefined {
	const e = cache.get(key);
	if (e && e.expires > Date.now()) return e.value;
	if (e) cache.delete(key);
	return undefined;
}
function writeCache<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T) {
	cache.set(key, { value, expires: Date.now() + NAME_CACHE_TTL_MS });
}

const app = new Hono<{
	Bindings: Env & { OAUTH_PROVIDER: OAuthHelpers };
	Variables: { cfAccessEmail: string };
}>();

app.use("*", cfAccessMiddleware);

app.on("GET", ["/", "/allowlist", "/activity", "/clients", "/settings"], (c) => {
	const seg = new URL(c.req.url).pathname.split("/").filter(Boolean).pop() ?? "";
	const activeTab = seg === "activity" || seg === "clients" || seg === "settings" ? seg : "allowlist";
	const act = (t: string) => (t === activeTab ? " active" : "");
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
		.panel { display: none; }
		.panel.active { display: block; }
		.panel[data-panel="settings"] { max-width: 48rem; }
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
		.avatar { width: 2rem; height: 2rem; border-radius: 9999px; background: var(--muted); color: var(--muted-foreground); display: inline-flex; align-items: center; justify-content: center; font-weight: 500; flex-shrink: 0; text-transform: uppercase; }
		.user-name { font-weight: 500; }

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
		td.outcome { min-width: 18rem; word-break: break-word; }
		.empty { text-align: center; color: var(--muted-foreground); padding: 1rem 0; font-size: 0.875rem; }

		/* Status */
		.status { padding: 0.5rem 0.75rem; border-radius: calc(var(--radius) - 2px); margin-top: 0.75rem; font-size: 0.8125rem; display: none; border: 1px solid; max-width: 32rem; }
		.status.error { display: block; background: var(--status-error-bg); color: var(--status-error-fg); border-color: var(--status-error-border); }
		.status.success { display: block; background: var(--status-success-bg); color: var(--status-success-fg); border-color: var(--status-success-border); }
		.banner-warn { padding: 0.75rem 1rem; border-radius: var(--radius); margin-bottom: 1rem; font-size: 0.875rem; background: var(--status-error-bg); color: var(--status-error-fg); border: 1px solid var(--status-error-border); }

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
		td.audit-user { cursor: pointer; }
		tbody tr.audit-row { cursor: pointer; }
		tr.detail-row { background: var(--muted); }
		tr.detail-row:hover { background: var(--muted); }
		tr.detail-row td { padding: 0.75rem 1rem; font-family: var(--font-mono); font-size: 0.75rem; white-space: pre-wrap; word-break: break-word; }
		.load-more { text-align: center; padding: 0.75rem; }
		.hbar-row.clickable { cursor: pointer; }
		.hbar-row.clickable:hover .hbar-label { color: var(--foreground); text-decoration: underline; }

		/* Stat cards + charts */
		.stat-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.75rem; margin-bottom: 1rem; }
		.stat-card { border: 1px solid var(--border); border-radius: var(--radius); padding: 0.75rem 1rem; background: var(--card); }
		.stat-label { font-size: 0.75rem; color: var(--muted-foreground); font-weight: 500; }
		.stat-value { font-size: 1.5rem; font-weight: 600; margin-top: 0.125rem; font-variant-numeric: tabular-nums; }
		.stat-value.danger { color: var(--destructive); }
		.chart-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; margin-bottom: 1rem; }
		.chart-card { padding: 0.875rem 1rem; }
		.chart-title { font-size: 0.75rem; font-weight: 500; color: var(--muted-foreground); margin-bottom: 0.75rem; }
		.hbar-row { display: flex; align-items: center; gap: 0.625rem; margin-bottom: 0.375rem; }
		.hbar-row:last-child { margin-bottom: 0; }
		.hbar-label { width: 9rem; flex-shrink: 0; font-family: var(--font-mono); font-size: 0.75rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
		.hbar-track { flex: 1; height: 1.125rem; background: var(--muted); border-radius: 2px; overflow: hidden; display: flex; }
		.hbar-fill { background: var(--primary); }
		.hbar-fill-err { background: var(--destructive); }
		.hbar-value { width: 2.5rem; text-align: right; font-family: var(--font-mono); font-size: 0.75rem; color: var(--muted-foreground); flex-shrink: 0; }
		.sparkbar { display: flex; align-items: flex-end; gap: 2px; height: 6rem; }
		.sparkbar-col { flex: 1; background: var(--primary); border-radius: 1px 1px 0 0; min-height: 1px; transition: opacity 0.1s; }
		.sparkbar-col:hover { opacity: 0.7; }
		.sparkbar-col.zero { background: var(--muted); }
		.timeline-grid { display: grid; grid-template-columns: auto 1fr; column-gap: 0.5rem; row-gap: 0.375rem; align-items: start; }
		.sparkbar-yaxis { display: flex; flex-direction: column; justify-content: space-between; height: 6rem; font-size: 0.6875rem; color: var(--muted-foreground); font-family: var(--font-mono); text-align: right; }
		.sparkbar-axis { display: flex; font-size: 0.6875rem; color: var(--muted-foreground); font-family: var(--font-mono); }
		.sparkbar-axis span { flex: 1; white-space: nowrap; overflow: hidden; }
		.spark-tip { position: fixed; background: var(--foreground); color: var(--background); padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-family: var(--font-mono); pointer-events: none; white-space: nowrap; z-index: 10; transform: translate(-50%, calc(-100% - 6px)); display: none; }
		.spark-tip::after { content: ""; position: absolute; top: 100%; left: 50%; transform: translateX(-50%); border: 4px solid transparent; border-top-color: var(--foreground); }
		.stats-toolbar { display: flex; justify-content: flex-end; margin-bottom: 1rem; }
		.segmented { display: inline-flex; padding: 0.1875rem; background: var(--muted); border-radius: var(--radius); }
		.segmented button { border: none; background: transparent; color: var(--muted-foreground); font-size: 0.75rem; font-weight: 500; padding: 0.3125rem 0.75rem; border-radius: calc(var(--radius) - 2px); cursor: pointer; transition: background-color 0.15s, color 0.15s; font-family: inherit; }
		.segmented button:hover { color: var(--foreground); }
		.segmented button.active { background: var(--background); color: var(--foreground); box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05); }
		.chart-span { grid-column: 1 / -1; }
	</style>
</head>
<body data-tab="${activeTab}">
	<header class="topbar">
		<div class="topbar-title">GuildBridge Admin</div>
		<div class="topbar-user">${adminEmail}</div>
	</header>
	<div class="layout">
		<nav class="sidebar">
			<a class="nav-item${act("allowlist")}" href="/admin/allowlist" data-tab="allowlist">Allowlist</a>
			<a class="nav-item${act("activity")}" href="/admin/activity" data-tab="activity">Activity</a>
			<a class="nav-item${act("clients")}" href="/admin/clients" data-tab="clients">Clients</a>
			<a class="nav-item${act("settings")}" href="/admin/settings" data-tab="settings">Settings</a>
		</nav>
		<main class="content">
			<div class="panel${act("allowlist")}" data-panel="allowlist">
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
				<div id="allowlistBanner"></div>
				<div class="card">
					<table>
						<thead><tr><th>User</th><th>Username</th><th>User ID</th><th>Last seen</th><th>Calls</th><th>Added</th><th></th></tr></thead>
						<tbody id="userList"></tbody>
					</table>
				</div>
			</div>
			<div class="panel${act("activity")}" data-panel="activity">
				<div class="panel-header">
					<h2>Activity</h2>
					<p>Recent MCP tool invocations across all users.</p>
				</div>
				<div class="stats-toolbar">
					<div class="segmented" id="statsRange">
						<button type="button" data-range="24h" class="active">24h</button>
						<button type="button" data-range="week">Week</button>
						<button type="button" data-range="month">Month</button>
						<button type="button" data-range="60d">60d</button>
						<button type="button" data-range="90d">90d</button>
						<button type="button" data-range="365d">1y</button>
					</div>
				</div>
				<div class="stat-grid">
					<div class="stat-card"><div class="stat-label">Calls</div><div class="stat-value" id="statTotal">—</div></div>
					<div class="stat-card"><div class="stat-label">Errors</div><div class="stat-value" id="statErrors">—</div></div>
					<div class="stat-card"><div class="stat-label">Avg duration</div><div class="stat-value" id="statDuration">—</div></div>
					<div class="stat-card"><div class="stat-label">Active users</div><div class="stat-value" id="statUsers">—</div></div>
				</div>
				<div class="chart-grid">
					<div class="card chart-card">
						<div class="chart-title">Calls by tool</div>
						<div id="chartByTool"></div>
					</div>
					<div class="card chart-card">
						<div class="chart-title">Top users</div>
						<div id="chartTopUsers"></div>
					</div>
					<div class="card chart-card chart-span">
						<div class="chart-title">Activity over time</div>
						<div class="timeline-grid">
							<div id="chartTimelineY" class="sparkbar-yaxis"></div>
							<div id="chartTimeline" class="sparkbar"></div>
							<div></div>
							<div id="chartTimelineAxis" class="sparkbar-axis"></div>
						</div>
					</div>
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
						<select id="filterOutcome">
							<option value="">All outcomes</option>
							<option value="ok">OK only</option>
							<option value="error">Errors only</option>
						</select>
						<input type="text" id="filterUser" placeholder="Filter by user ID" />
						<button class="button button-primary" onclick="loadAudit()">Filter</button>
					</div>
				</div>
				<div class="card">
					<table>
						<thead><tr><th>Time</th><th>User</th><th>User ID</th><th>Tool</th><th>Target</th><th>Duration</th><th>Outcome</th></tr></thead>
						<tbody id="auditList"></tbody>
					</table>
				</div>
				<div class="load-more">
					<button class="button button-ghost" id="loadMoreBtn" onclick="loadAudit(true)" style="display:none">Load more</button>
				</div>
			</div>
			<div class="panel${act("clients")}" data-panel="clients">
				<div class="panel-header">
					<h2>Registered OAuth Clients</h2>
					<p>OAuth clients that have registered with GuildBridge.</p>
				</div>
				<div class="card">
					<table>
						<thead><tr><th>Name</th><th>Client ID</th><th>Redirect URIs</th><th>Registered</th><th>Auth Method</th></tr></thead>
						<tbody id="clientList"></tbody>
					</table>
				</div>
			</div>
			<div class="panel${act("settings")}" data-panel="settings">
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

		function showTab(tab) {
			document.querySelectorAll(".nav-item").forEach(function (n) { n.classList.toggle("active", n.dataset.tab === tab); });
			document.querySelectorAll(".panel").forEach(function (p) { p.classList.toggle("active", p.dataset.panel === tab); });
			if (tab === "activity") { loadStats(); loadAudit(); }
			if (tab === "allowlist") loadUsers();
		}
		document.querySelectorAll(".nav-item").forEach(function (el) {
			el.addEventListener("click", function (e) {
				if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
				e.preventDefault();
				var tab = el.dataset.tab;
				history.pushState({ tab: tab }, "", el.href);
				showTab(tab);
			});
		});
		window.addEventListener("popstate", function (e) {
			showTab((e.state && e.state.tab) || "allowlist");
		});
		async function loadUsers() {
			const el = document.getElementById("userList");
			const banner = document.getElementById("allowlistBanner");
			try {
				const resp = await fetch("/admin/api/users");
				const data = await resp.json();
				const users = data.users || [];
				if (users.length === 0) {
					banner.className = "banner-warn";
					banner.textContent = "Allowlist is empty — nobody can authenticate. Add at least one Discord user to enable the MCP server.";
				} else {
					banner.className = "";
					banner.textContent = "";
				}
				let html = "";
				for (const u of users) {
					const name = u.global_name || u.username || u.id;
					const date = u.added_at ? new Date(u.added_at).toLocaleDateString() : "—";
					html += "<tr>";
					html += "<td><div class='user-cell'><div class='avatar'>" + esc(name.charAt(0)) + "</div><span class='user-name'>" + esc(name) + "</span></div></td>";
					html += '<td class="mono">' + (u.username ? "@" + esc(u.username) : "—") + "</td>";
					html += '<td class="mono">' + esc(u.id) + "</td>";
					html += '<td class="muted">' + relTime(u.last_ts) + "</td>";
					html += '<td class="mono">' + (u.calls || 0) + "</td>";
					html += '<td class="muted">' + esc(date) + "</td>";
					html += '<td class="actions"><button class="button button-ghost" onclick="removeUser(' + esc(JSON.stringify(u.id)) + ', ' + esc(JSON.stringify(name)) + ')">Remove</button></td>';
					html += "</tr>";
				}
				el.innerHTML = html;
			} catch (e) {
				el.innerHTML = '<tr><td colspan="7" class="empty">Failed to load users</td></tr>';
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
		async function removeUser(id, name) {
			var grantCount = 0;
			try {
				const r = await fetch("/admin/api/users/" + id + "/grants");
				const d = await r.json();
				grantCount = d.count || 0;
			} catch (e) {}
			var msg = "Remove " + (name || id) + " from the allowlist?";
			if (grantCount > 0) msg += " This will also revoke their " + grantCount + " active session(s).";
			if (!confirm(msg)) return;
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
			d.textContent = String(s);
			return d.innerHTML.replace(/"/g, "&quot;");
		}
		function relTime(ts) {
			if (!ts) return "—";
			var diff = Date.now() - ts;
			var m = 60000, h = 60*m, d = 24*h;
			if (diff < m) return "just now";
			if (diff < h) return Math.floor(diff/m) + "m ago";
			if (diff < d) return Math.floor(diff/h) + "h ago";
			return Math.floor(diff/d) + "d ago";
		}
		async function loadClients() {
			const el = document.getElementById("clientList");
			try {
				const resp = await fetch("/admin/api/clients");
				const data = await resp.json();
				if (!data.clients || data.clients.length === 0) {
					el.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--muted-fg);padding:2rem">No registered clients</td></tr>';
					return;
				}
				let html = "";
				for (const cl of data.clients) {
					const name = cl.clientName || "\u2014";
					const uris = (cl.redirectUris || []).join(", ") || "\u2014";
					const date = cl.registrationDate ? new Date(cl.registrationDate * 1000).toLocaleDateString() : "\u2014";
					const authMethod = cl.tokenEndpointAuthMethod || "\u2014";
					html += "<tr>";
					html += "<td>" + esc(name) + "</td>";
					html += "<td><code>" + esc(cl.clientId) + "</code></td>";
					html += '<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(uris) + '">' + esc(uris) + "</td>";
					html += "<td>" + esc(date) + "</td>";
					html += "<td>" + esc(authMethod) + "</td>";
					html += "</tr>";
				}
				el.innerHTML = html;
			} catch (e) {
				el.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--muted-fg);padding:2rem">Failed to load clients</td></tr>';
			}
		}
		var auditEvents = [];
		var auditCursor = null;
		async function loadAudit(append) {
			if (append !== true) { auditEvents = []; auditCursor = null; append = false; }
			const el = document.getElementById("auditList");
			const btn = document.getElementById("loadMoreBtn");
			const tool = document.getElementById("filterTool").value;
			const userId = document.getElementById("filterUser").value.trim();
			const outcome = document.getElementById("filterOutcome").value;
			const params = new URLSearchParams({ limit: "50" });
			if (tool) params.set("tool", tool);
			if (userId) params.set("user_id", userId);
			if (outcome) params.set("outcome", outcome);
			if (append && auditCursor) params.set("before_id", auditCursor);
			try {
				const resp = await fetch("/admin/api/audit?" + params.toString());
				const data = await resp.json();
				const events = data.events || [];
				const base = auditEvents.length;
				auditEvents = auditEvents.concat(events);
				if (events.length) auditCursor = events[events.length - 1].id;
				let html = "";
				for (let i = 0; i < events.length; i++) {
					const e = events[i];
					const time = new Date(e.ts).toLocaleString();
					let target;
					if (e.channel_name) {
						target = (e.guild_name ? esc(e.guild_name) + " " : "") + "#" + esc(e.channel_name);
					} else if (e.channel_id) {
						target = "ch " + esc(e.channel_id);
					} else if (e.guild_name) {
						target = esc(e.guild_name);
					} else if (e.guild_id) {
						target = "guild " + esc(e.guild_id);
					} else {
						target = "—";
					}
					const outcomeText = e.outcome === "error" ? (e.error ? esc(e.error.slice(0, 60)) : "error") : "ok";
					const rowCls = e.outcome === "error" ? "audit-row outcome-error" : "audit-row";
					html += '<tr class="' + rowCls + '" data-idx="' + (base + i) + '">';
					html += "<td>" + esc(time) + "</td>";
					html += "<td>" + esc(e.username || "—") + "</td>";
					html += '<td class="mono audit-user" data-user-id="' + esc(e.user_id) + '" title="Click to filter by this user">' + esc(e.user_id) + "</td>";
					html += "<td>" + esc(e.tool) + "</td>";
					html += '<td class="mono">' + target + "</td>";
					html += "<td>" + e.duration_ms + "ms</td>";
					html += '<td class="outcome">' + outcomeText + "</td>";
					html += "</tr>";
				}
				if (append) el.insertAdjacentHTML("beforeend", html);
				else el.innerHTML = html || '<tr><td colspan="7" class="empty">No activity</td></tr>';
				btn.style.display = data.has_more ? "" : "none";
			} catch (err) {
				if (!append) el.innerHTML = '<tr><td colspan="7" class="empty">Failed to load activity</td></tr>';
				btn.style.display = "none";
			}
		}
		function rangeSince(key) {
			var now = Date.now();
			var D = 86400000;
			if (key === "week") {
				var d = new Date();
				d.setHours(0, 0, 0, 0);
				d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
				return d.getTime();
			}
			if (key === "month") {
				var d = new Date();
				return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
			}
			if (key === "60d") return now - 60 * D;
			if (key === "90d") return now - 90 * D;
			if (key === "365d") return now - 365 * D;
			return now - D;
		}
		function hbarChart(rows, getLabel, getTotal, getErr, getKey) {
			var max = Math.max(1, ...rows.map(getTotal));
			var html = "";
			for (const r of rows) {
				var total = getTotal(r), err = getErr ? (getErr(r) || 0) : 0;
				var okPct = ((total - err) / max * 100).toFixed(1);
				var errPct = (err / max * 100).toFixed(1);
				var keyAttr = getKey ? ' data-key="' + esc(getKey(r)) + '"' : "";
				var cls = getKey ? "hbar-row clickable" : "hbar-row";
				html += '<div class="' + cls + '"' + keyAttr + '>';
				html += '<span class="hbar-label" title="' + esc(getLabel(r)) + '">' + esc(getLabel(r)) + '</span>';
				html += '<div class="hbar-track">';
				html += '<div class="hbar-fill" style="width:' + okPct + '%"></div>';
				if (err) html += '<div class="hbar-fill-err" style="width:' + errPct + '%" title="' + err + ' errors"></div>';
				html += '</div>';
				html += '<span class="hbar-value">' + total + '</span>';
				html += '</div>';
			}
			return html || '<div class="empty">No activity</div>';
		}
		async function loadStats() {
			var activeBtn = document.querySelector("#statsRange button.active");
			var since = rangeSince(activeBtn ? activeBtn.dataset.range : "24h");
			try {
				const resp = await fetch("/admin/api/audit/stats?since=" + since);
				const s = await resp.json();
				const o = s.overview || {};
				document.getElementById("statTotal").textContent = o.total || 0;
				const errEl = document.getElementById("statErrors");
				const errs = o.errors || 0;
				errEl.textContent = errs;
				errEl.classList.toggle("danger", errs > 0);
				document.getElementById("statDuration").textContent = o.avg_ms != null ? Math.round(o.avg_ms) + "ms" : "—";
				document.getElementById("statUsers").textContent = o.users || 0;

				document.getElementById("chartByTool").innerHTML = hbarChart(
					s.by_tool || [], function(t){return t.tool}, function(t){return t.calls}, function(t){return t.errors}, function(t){return t.tool}
				);
				document.getElementById("chartTopUsers").innerHTML = hbarChart(
					s.top_users || [], function(u){return u.username || u.user_id}, function(u){return u.calls}, null, function(u){return u.user_id}
				);

				var bucketMs = s.bucket_ms;
				var windowStart = s.since;
				var nBuckets = Math.max(1, Math.ceil((Date.now() - windowStart) / bucketMs));
				var buckets = new Array(nBuckets).fill(0);
				for (const h of (s.timeline || [])) {
					if (h.bucket >= 0 && h.bucket < nBuckets) buckets[h.bucket] = h.calls;
				}
				var maxB = Math.max(1, ...buckets);
				document.getElementById("chartTimelineY").innerHTML =
					"<span>" + maxB + "</span><span>" + Math.round(maxB / 2) + "</span><span>0</span>";
				var fmt = bucketMs < 86400000
					? function(t){ return t.getHours() + ":00"; }
					: function(t){ return (t.getMonth()+1) + "/" + t.getDate(); };
				var tlHtml = "";
				for (var i = 0; i < nBuckets; i++) {
					var pct = (buckets[i] / maxB * 100).toFixed(1);
					var label = fmt(new Date(windowStart + i * bucketMs));
					var cls = buckets[i] === 0 ? "sparkbar-col zero" : "sparkbar-col";
					tlHtml += '<div class="' + cls + '" style="height:' + pct + '%" data-tip="' + label + ' — ' + buckets[i] + '"></div>';
				}
				document.getElementById("chartTimeline").innerHTML = tlHtml;

				var step = Math.max(1, Math.ceil(nBuckets / 6));
				var axisHtml = "";
				for (var i = 0; i < nBuckets; i += step) {
					axisHtml += '<span style="flex:' + Math.min(step, nBuckets - i) + '">' + fmt(new Date(windowStart + i * bucketMs)) + '</span>';
				}
				document.getElementById("chartTimelineAxis").innerHTML = axisHtml;
			} catch (e) {}
		}
		document.getElementById("userId").addEventListener("keydown", function(e) {
			if (e.key === "Enter") addUser();
		});
		document.getElementById("filterUser").addEventListener("keydown", function(e) {
			if (e.key === "Enter") loadAudit();
		});
		document.getElementById("auditList").addEventListener("click", function(e) {
			var cell = e.target.closest(".audit-user");
			if (cell) {
				document.getElementById("filterUser").value = cell.dataset.userId;
				loadAudit();
				return;
			}
			var row = e.target.closest("tr.audit-row");
			if (!row) return;
			var next = row.nextElementSibling;
			if (next && next.classList.contains("detail-row")) { next.remove(); return; }
			var ev = auditEvents[+row.dataset.idx];
			if (!ev) return;
			var detail = "";
			if (ev.guild_id) detail += "guild_id:   " + ev.guild_id + "\\n";
			if (ev.channel_id) detail += "channel_id: " + ev.channel_id + "\\n";
			if (ev.message_id) detail += "message_id: " + ev.message_id + "\\n";
			if (ev.error) detail += "\\nerror:\\n" + ev.error;
			if (!detail) detail = "(no additional detail)";
			var tr = document.createElement("tr");
			tr.className = "detail-row";
			var td = document.createElement("td");
			td.colSpan = 7;
			td.textContent = detail;
			tr.appendChild(td);
			row.after(tr);
		});
		document.getElementById("chartByTool").addEventListener("click", function(e) {
			var row = e.target.closest(".hbar-row");
			if (!row || !row.dataset.key) return;
			document.getElementById("filterTool").value = row.dataset.key;
			loadAudit();
		});
		document.getElementById("chartTopUsers").addEventListener("click", function(e) {
			var row = e.target.closest(".hbar-row");
			if (!row || !row.dataset.key) return;
			document.getElementById("filterUser").value = row.dataset.key;
			loadAudit();
		});
		document.getElementById("filterTool").addEventListener("change", function() { loadAudit(); });
		document.getElementById("filterOutcome").addEventListener("change", function() { loadAudit(); });
		document.getElementById("statsRange").addEventListener("click", function(e) {
			var btn = e.target.closest("button");
			if (!btn || btn.classList.contains("active")) return;
			this.querySelectorAll("button").forEach(function(b) { b.classList.toggle("active", b === btn); });
			loadStats();
		});
		(function() {
			var tip = document.createElement("div");
			tip.className = "spark-tip";
			document.body.appendChild(tip);
			var tl = document.getElementById("chartTimeline");
			tl.addEventListener("mouseover", function(e) {
				var col = e.target.closest(".sparkbar-col");
				if (!col) return;
				tip.textContent = col.dataset.tip;
				var r = col.getBoundingClientRect();
				tip.style.left = (r.left + r.width / 2) + "px";
				tip.style.top = r.top + "px";
				tip.style.display = "block";
			});
			tl.addEventListener("mouseleave", function() { tip.style.display = "none"; });
		})();
		setTheme(getStoredTheme() || "light");
		var initialTab = document.body.dataset.tab;
		history.replaceState({ tab: initialTab }, "", "/admin/" + initialTab);
		showTab(initialTab);
		loadClients();
	</script>
</body>
</html>`;
	return c.html(html);
});

app.get("/api/users", async (c) => {
	const ids = await getAllowlist(c.env.OAUTH_KV);

	const users: (AdminUser & { last_ts?: number; calls?: number })[] = [];
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

	if (ids.length) {
		const placeholders = ids.map(() => "?").join(",");
		const { results } = await c.env.AUDIT_DB.prepare(
			`SELECT user_id, MAX(ts) AS last_ts, COUNT(*) AS calls FROM audit_log WHERE user_id IN (${placeholders}) GROUP BY user_id`,
		)
			.bind(...ids)
			.all<{ user_id: string; last_ts: number; calls: number }>();
		const byId = new Map(results.map((r) => [r.user_id, r]));
		for (const u of users) {
			const stats = byId.get(u.id);
			if (stats) {
				u.last_ts = stats.last_ts;
				u.calls = stats.calls;
			}
		}
	}

	return c.json({ users });
});

app.get("/api/users/:id/grants", async (c) => {
	const userId = c.req.param("id");
	const { items } = await c.env.OAUTH_PROVIDER.listUserGrants(userId);
	return c.json({ count: items.length });
});

app.post("/api/users", async (c) => {
	const body = await c.req.json<{ discord_id?: string }>();
	const discordId = body.discord_id?.trim();
	if (!discordId || !/^\d+$/.test(discordId)) {
		return c.json({ error: "Invalid Discord user ID" }, 400);
	}

	// Early check before expensive Discord API call
	const ids = await getAllowlist(c.env.OAUTH_KV);
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
	const freshIds = await getAllowlist(c.env.OAUTH_KV);
	if (freshIds.includes(discordId)) {
		return c.json({ error: "User already in allowlist" }, 409);
	}

	freshIds.push(discordId);
	await Promise.all([
		c.env.OAUTH_KV.put(ALLOWLIST_KEY, JSON.stringify(freshIds)),
		c.env.OAUTH_KV.put(`admin:user:${discordId}`, JSON.stringify(meta)),
	]);

	return c.json({ user: meta }, 201);
});

app.delete("/api/users/:id", async (c) => {
	const targetId = c.req.param("id");
	if (!targetId || !/^\d+$/.test(targetId)) {
		return c.json({ error: "Invalid user ID" }, 400);
	}

	const ids = await getAllowlist(c.env.OAUTH_KV);
	const filtered = ids.filter((id) => id !== targetId);

	if (filtered.length === ids.length) {
		return c.json({ error: "User not in allowlist" }, 404);
	}

	await Promise.all([
		c.env.OAUTH_KV.put(ALLOWLIST_KEY, JSON.stringify(filtered)),
		c.env.OAUTH_KV.delete(`admin:user:${targetId}`),
	]);

	// Revoke active OAuth sessions. If this throws, the allowlist mutation
	// above already landed — their next token refresh will be rejected anyway.
	try {
		const { items } = await c.env.OAUTH_PROVIDER.listUserGrants(targetId);
		await Promise.all(items.map((g) => c.env.OAUTH_PROVIDER.revokeGrant(g.id, targetId)));
	} catch (err) {
		console.error("revokeGrant failed for", targetId, err);
	}

	return c.json({ ok: true });
});

app.get("/api/clients", async (c) => {
	try {
		const result = await c.env.OAUTH_PROVIDER.listClients();
		const clients = result.items.map((cl) => ({
			clientId: cl.clientId,
			clientName: cl.clientName ?? null,
			redirectUris: cl.redirectUris,
			registrationDate: cl.registrationDate ?? null,
			tokenEndpointAuthMethod: cl.tokenEndpointAuthMethod,
			grantTypes: cl.grantTypes ?? null,
			responseTypes: cl.responseTypes ?? null,
			clientUri: cl.clientUri ?? null,
			logoUri: cl.logoUri ?? null,
			contacts: cl.contacts ?? null,
		}));
		return c.json({ clients });
	} catch {
		return c.json({ clients: [] });
	}
});

app.get("/api/audit", async (c) => {
	const limit = Math.min(Number(c.req.query("limit")) || 50, 200);
	const userId = c.req.query("user_id");
	const tool = c.req.query("tool");
	const outcome = c.req.query("outcome");
	const beforeId = Number(c.req.query("before_id"));

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
	if (outcome) {
		clauses.push("outcome = ?");
		binds.push(outcome);
	}
	if (Number.isFinite(beforeId) && beforeId > 0) {
		clauses.push("id < ?");
		binds.push(beforeId);
	}
	const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

	const { results } = await c.env.AUDIT_DB.prepare(
		`SELECT id, ts, tool, user_id, username, outcome, duration_ms, guild_id, channel_id, message_id, error FROM audit_log ${where} ORDER BY id DESC LIMIT ?`,
	)
		.bind(...binds, limit)
		.all();

	type AuditRow = {
		guild_id: string | null;
		channel_id: string | null;
		guild_name?: string;
		channel_name?: string;
		[k: string]: unknown;
	};
	const events = results as AuditRow[];
	const token = c.env.DISCORD_BOT_TOKEN;

	// getChannel() returns both name and guild_id — one call backfills both for
	// rows that only carry channel_id.
	const channelIds = [...new Set(events.map((e) => e.channel_id).filter((id): id is string => !!id))];
	const uncachedCh = channelIds.filter((id) => !readCache(channelCache, id));
	if (uncachedCh.length) {
		await Promise.all(
			uncachedCh.map(async (id) => {
				try {
					const ch = await getChannel(token, id);
					writeCache(channelCache, id, { name: ch.name ?? id, guild_id: ch.guild_id ?? "" });
				} catch {}
			}),
		);
	}

	const guildIds = new Set<string>();
	for (const e of events) {
		if (e.guild_id) guildIds.add(e.guild_id);
		if (e.channel_id) {
			const ch = readCache(channelCache, e.channel_id);
			if (ch?.guild_id) guildIds.add(ch.guild_id);
		}
	}
	if ([...guildIds].some((id) => !readCache(guildNameCache, id))) {
		try {
			const guilds = await listBotGuilds(token);
			for (const g of guilds) writeCache(guildNameCache, g.id, g.name);
		} catch {}
	}

	for (const e of events) {
		if (e.channel_id) {
			const ch = readCache(channelCache, e.channel_id);
			if (ch) {
				e.channel_name = ch.name;
				if (!e.guild_id && ch.guild_id) e.guild_id = ch.guild_id;
			}
		}
		if (e.guild_id) {
			e.guild_name = readCache(guildNameCache, e.guild_id);
		}
	}

	return c.json({ events, has_more: events.length === limit });
});

app.get("/api/audit/stats", async (c) => {
	const now = Date.now();
	const sinceParam = Number(c.req.query("since"));
	const since =
		Number.isFinite(sinceParam) && sinceParam > 0 && sinceParam < now
			? sinceParam
			: now - 24 * 60 * 60 * 1000;

	const H = 3600000;
	const D = 24 * H;
	const range = now - since;
	const bucketMs = range <= 48 * H ? H : range <= 90 * D ? D : 7 * D;

	const db = c.env.AUDIT_DB;
	const [overview, byTool, topUsers, timeline] = await db.batch([
		db
			.prepare(
				"SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN outcome='error' THEN 1 ELSE 0 END),0) AS errors, AVG(duration_ms) AS avg_ms, COUNT(DISTINCT user_id) AS users FROM audit_log WHERE ts > ?",
			)
			.bind(since),
		db
			.prepare(
				"SELECT tool, COUNT(*) AS calls, SUM(CASE WHEN outcome='error' THEN 1 ELSE 0 END) AS errors FROM audit_log WHERE ts > ? GROUP BY tool ORDER BY calls DESC",
			)
			.bind(since),
		db
			.prepare(
				"SELECT user_id, MAX(username) AS username, COUNT(*) AS calls FROM audit_log WHERE ts > ? GROUP BY user_id ORDER BY calls DESC LIMIT 10",
			)
			.bind(since),
		db
			.prepare(
				"SELECT CAST((ts - ?) / ? AS INTEGER) AS bucket, COUNT(*) AS calls FROM audit_log WHERE ts > ? GROUP BY bucket ORDER BY bucket",
			)
			.bind(since, bucketMs, since),
	]);

	return c.json({
		since,
		bucket_ms: bucketMs,
		overview: overview.results[0],
		by_tool: byTool.results,
		top_users: topUsers.results,
		timeline: timeline.results,
	});
});

export { app as adminApp };
