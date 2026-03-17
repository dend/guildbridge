# CLAUDE.md

## Build & Check Commands

- `npm run dev` — Start local dev server (port 8788)
- `npm run deploy` — Deploy to Cloudflare Workers
- `npm run type-check` — Run `tsc --noEmit` (no test suite exists)

## Project Overview

GuildBridge is a remote MCP server deployed on Cloudflare Workers. It exposes Discord operations (read, search, post messages) as MCP tools. Authentication is via Discord OAuth; all Discord API calls use a bot token.

## Architecture

- **`src/index.ts`** — MCP server definition, tool handlers, access control logic (guild + channel)
- **`src/discord-api.ts`** — Discord REST API wrappers, types, and permission computation
- **`src/discord-handler.ts`** — Discord OAuth flow (Hono routes)
- **`src/utils.ts`** — OAuth token exchange helpers, `Props` type (user identity stored in auth token)
- **`src/workers-oauth-utils.ts`** — CSRF/session/state management
- **`src/cf-access.ts`** — Cloudflare Access JWT validation middleware
- **`src/admin.ts`** — Admin panel UI + API: Allowlist tab (KV), Activity tab (D1 audit log)
- **`src/audit.ts`** — Tool-call audit: dual-write to D1 + Analytics Engine

## Key Design Decisions

### Access control is two-layered
1. **Guild membership** — checked via the user's OAuth access token (`listUserGuilds`). Cached 60s.
2. **Channel visibility** — computed using Discord's permission algorithm (`computePermissions`). Uses bot token to fetch guild roles, member roles, and channel permission overwrites. Cached 60s per guild.

### Bot token vs user token
All Discord API calls use the bot token. The user's OAuth token is only used to verify guild membership (`/users/@me/guilds` with `Bearer` auth). This means the bot must be in any guild the user wants to access.

### Permission computation follows Discord's algorithm
`computePermissions` in `discord-api.ts` implements the standard Discord permission resolution:
1. Start with @everyone role permissions
2. OR in member's role permissions
3. Short-circuit if ADMINISTRATOR
4. Apply channel-level overwrites: @everyone → roles → member-specific
Guild owners bypass permission checks entirely.

### Caching strategy
- **Guild membership** (`getUserGuildIds`): 60s TTL, keyed per MCP session
- **Permission context** (`getGuildPermContext`): 60s TTL, keyed by guild ID per session
- Caches are in-memory Maps scoped to the `init()` closure, so they're per-session

### User allowlist (admin panel)
User access is controlled by a KV-backed allowlist, managed at runtime via the `/admin` panel. The OAuth callback calls `isUserAllowed()` (exported from `admin.ts`), which is the single source of truth — empty list means no restriction (fail-open for initial setup).

The admin panel (`/admin`) is a Hono sub-app mounted in `discord-handler.ts`. It is protected by Cloudflare Access (Zero Trust) externally, with defense-in-depth JWT validation in `cf-access.ts`. KV keys use the `admin:` prefix (`admin:allowlist` for the ID array, `admin:user:{id}` for per-user metadata).

**Required setup for the admin panel:**
- Create a CF Access Application in Zero Trust dashboard for `<domain>/admin*`
- Set secrets: `CF_ACCESS_TEAM_DOMAIN` (team name), `CF_ACCESS_AUD` (Application Audience tag)
- For local dev: set `DEV_SKIP_CF_ACCESS=true` in `.dev.vars` to bypass JWT validation

### Tool-call auditing
Every tool invocation flows through the `tool()` wrapper in `index.ts` (defined at the top of `init()`). The wrapper times the call, passes an `AuditContext` bag the handler can write into (used by `send_message`/`reply_to_message` to surface the created `message_id`), and calls `recordAudit()` on both success and error paths. The D1 write is wrapped in `this.ctx.waitUntil()` so it never blocks the tool response; the Analytics Engine write is synchronous fire-and-forget.

Analytics Engine is positional: `indexes[0]` = userId, `blobs` = `[tool, username, outcome, guildId, channelId, messageId, error]`, `doubles` = `[durationMs]`. In local dev the AE binding is a no-op stub — only D1 writes land locally.

### Search result filtering
Search results don't include `permission_overwrites`, so we fetch channel info for each unique `channel_id` in the results (in parallel) and filter out messages from non-visible channels.

## Style

- TypeScript strict mode
- Tabs for indentation
- Double quotes for strings
- Semicolons used
- Prefer `const` closures over class methods for access control functions
