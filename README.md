# Guildbridge

Remote MCP server for Discord, deployed on Cloudflare Workers. Exposes Discord read/search/post operations as MCP tools. Uses Discord OAuth to authenticate users and a Discord bot token for API calls.

## Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- A [Cloudflare](https://dash.cloudflare.com/) account
- A [Discord application](https://discord.com/developers/applications) with:
  - A **bot** added to the servers you want to access
  - **OAuth2** configured (client ID + secret)

## Discord App Setup

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) and create (or select) an application.
2. Under **Bot**, click "Reset Token" to get your bot token. Save it.
3. Under **OAuth2**, note the **Client ID** and **Client Secret**.
4. Under **OAuth2 > Redirects**, add your callback URL:
   - Local dev: `http://localhost:8788/callback`
   - Production: `https://<your-worker>.workers.dev/callback`
5. Under **Bot > Privileged Gateway Intents**, enable **Message Content Intent** if you want full message content in search results.
6. Invite the bot to your server(s) using OAuth2 URL Generator with the `bot` scope and `Read Message History` + `Send Messages` permissions.

## Local Development

```bash
# Install dependencies
npm install

# Copy the example env file and fill in your values
cp .dev.vars.example .dev.vars

# Start the dev server
npm run dev
```

The server runs at `http://localhost:8788`. The MCP endpoint is at `/mcp`.

### `.dev.vars`

| Variable | Description |
|---|---|
| `DISCORD_CLIENT_ID` | OAuth2 client ID from Discord Developer Portal |
| `DISCORD_CLIENT_SECRET` | OAuth2 client secret |
| `DISCORD_BOT_TOKEN` | Bot token (used for all Discord API calls) |
| `COOKIE_ENCRYPTION_KEY` | Random string for signing cookies — generate one with `openssl rand -hex 16` |
| `ALLOWED_DISCORD_USER_IDS` | Comma-separated Discord user IDs allowed to authenticate (empty = all users allowed) |

## Deploy to Cloudflare

```bash
# Create the KV namespace
npx wrangler kv namespace create OAUTH_KV
```

Copy the output `id` into `wrangler.jsonc` replacing `PLACEHOLDER_KV_ID`.

```bash
# Set secrets
npx wrangler secret put DISCORD_CLIENT_ID
npx wrangler secret put DISCORD_CLIENT_SECRET
npx wrangler secret put DISCORD_BOT_TOKEN
npx wrangler secret put COOKIE_ENCRYPTION_KEY
npx wrangler secret put ALLOWED_DISCORD_USER_IDS

# Deploy
npm run deploy
```

After deploying, Wrangler will print your worker URL (e.g. `https://guildbridge.<your-subdomain>.workers.dev`). Add `https://<your-worker-url>/callback` as a redirect URI in the Discord Developer Portal.

## Connect an MCP Client

Point any MCP client at the server URL:

```
https://<your-worker>.workers.dev/mcp
```

Or locally:

```
http://localhost:8788/mcp
```

To test with the MCP Inspector:

```bash
npx @modelcontextprotocol/inspector@latest
```

Enter the URL above, complete the Discord OAuth flow, and the tools will become available.

## Tools

| Tool | Description |
|---|---|
| `list_guilds` | List servers the bot is in |
| `list_channels` | List channels in a server (optionally filtered by type) |
| `get_channel_info` | Get channel details (topic, type, etc.) |
| `read_messages` | Read messages from a channel (with pagination) |
| `search_messages` | Search messages in a server (by content, channel, author) |
| `send_message` | Send a message to a channel |
| `reply_to_message` | Reply to a specific message |

## Project Structure

```
src/
  index.ts               # MCP server (tools) + OAuthProvider export
  discord-handler.ts     # Discord OAuth flow (Hono routes)
  discord-api.ts         # Discord REST API helpers + types
  utils.ts               # OAuth token exchange + Props type
  workers-oauth-utils.ts # CSRF/session/state management
```
