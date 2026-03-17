# Contributing to GuildBridge

Thanks for your interest in contributing! This guide covers everything you need to get started.

## Getting Started

1. [Fork](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/working-with-forks/fork-a-repo) the repository and clone your fork.
2. Install dependencies:

   ```bash
   npm install
   ```

3. Copy the example config files and fill in your values (see [README — Local Development](README.md#local-development)):

   ```bash
   cp wrangler.jsonc.example wrangler.jsonc
   cp .dev.vars.example .dev.vars
   ```

4. Start the dev server:

   ```bash
   npm run dev
   ```

## Code Style

- **TypeScript** in [strict mode](https://www.typescriptlang.org/tsconfig/#strict)
- **Tabs** for indentation
- **Double quotes** for strings
- **Semicolons** at end of statements
- Prefer `const` closures over class methods for access control functions

Run the linter and type checker before submitting:

```bash
npm run lint
npm run type-check
```

Auto-fixable lint issues (indentation, quotes, semicolons) can be resolved with:

```bash
npm run lint:fix
```

## Project Structure

```
src/
  index.ts               # MCP server (tools) + OAuthProvider export
  discord-handler.ts     # Discord OAuth flow (Hono routes)
  discord-api.ts         # Discord REST API helpers + types
  utils.ts               # OAuth token exchange + Props type
  workers-oauth-utils.ts # CSRF/session/state management
```

See the [Architecture section of CLAUDE.md](CLAUDE.md#architecture) for more detail on each module's responsibilities.

## Making Changes

1. Create a feature branch from `main`:

   ```bash
   git checkout -b my-feature
   ```

2. Make your changes. Keep commits focused — one logical change per commit.
3. Run `npm run lint` and `npm run type-check` to verify nothing is broken.
4. Push your branch and [open a pull request](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/creating-a-pull-request).

## Key Design Context

If you're working on access control or permissions logic, review these resources first:

- [Discord Permission Overwrites](https://discord.com/developers/docs/topics/permissions#permission-overwrites) — the algorithm GuildBridge implements in `computePermissions`
- [Discord OAuth2 Scopes](https://discord.com/developers/docs/topics/oauth2#shared-resources-oauth2-scopes) — GuildBridge uses `identify` and `guilds`
- [MCP Specification](https://modelcontextprotocol.io/specification) — the protocol this server implements

Bot token vs. user token distinction is important: all Discord API calls use the bot token. The user's OAuth token is only used to verify guild membership. See [CLAUDE.md — Key Design Decisions](CLAUDE.md#key-design-decisions) for the full rationale.

## AI Policy

If you use AI tools when contributing, please read the [AI Usage Policy](AI_POLICY.md). Disclosure is required for all AI-assisted contributions.

## Reporting Issues

Open a [GitHub issue](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-an-issue) with:

- A clear description of the problem or suggestion
- Steps to reproduce (for bugs)
- Expected vs. actual behavior

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
