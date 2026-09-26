# Fastmail Masked Email (local fork)

This is a personal fork of the store extension, with multi-account support
added. It runs only as a local dev extension. It is not published to the
Raycast Store, so do not use `npm run publish`.

## Commands

- `npm run build`: typecheck, bundle, and install into
  `~/.config/raycast/extensions/fastmail-masked-email`. Raycast loads the
  extension from there.
- `npm run dev`: `ray develop` with hot reload.
- `npx tsc --noEmit`, `npx eslint src`, `npx prettier --check src`: the checks.
  Run all three before a commit. There is no test suite.

If Raycast reports "Missing executable. You might need to build the
extension.", the install dir has no compiled JS. Run `npm run build` and read
the error that it prints.

## Constraints

- **No native modules.** `ray build` refuses any `.node` binding. keytar was
  removed for this reason. Check a new dependency for native code before you
  add it.
- **Toolchain versions follow `@raycast/api`.** `@types/react` and
  `@types/node` are pinned to the exact versions that the API declares as
  peers. Update them when you bump the API, or `tsc` rejects Raycast
  components as JSX elements.
- **TypeScript stays below 6.1.** `@raycast/eslint-config` 2.x has a peer
  range of `>=4.8.4 <6.1.0`. Do not move to TS 7 until that range allows it.
- ESLint uses flat config (`eslint.config.js`). The Raycast config does not
  load `eslint-plugin-react-hooks`, so an `eslint-disable` for a
  `react-hooks/*` rule is an error.

## Architecture

- `accounts.ts` owns account metadata (`id`, `name`, `isDefault`) as one JSON
  blob in LocalStorage under the `accounts` key. It also migrates the legacy
  `api_token` preference and legacy blobs that still hold tokens.
- `token-store.ts` owns API tokens, one LocalStorage key per account
  (`token:<accountId>`). Always get tokens through this module, at the moment
  of the API request. Never put a token back into `Account` or into form
  state.
- `api.ts` is the JMAP session and request layer. It throws
  `AuthenticationError` on a 401, so callers can tell a bad token from a
  transient failure.
- `fastmail.ts` holds the masked-email JMAP calls. Each call takes a token.
- Commands: `create`, `create-quick`, `list`, `manage-accounts`.

LocalStorage is encrypted at rest and scoped to this extension, per Raycast's
security docs. It is the correct store for secrets here. Do not move tokens to
the macOS Keychain; that needs a native module, which Raycast cannot build.

## Environment gotchas (Claude Code sandbox)

- The git repo root is the monorepo (`../../`), so `.git` is outside the
  sandbox write allowlist. Git writes (`add`, `commit`, `rm`) need an
  unsandboxed run.
- `npm run build` writes to `~/.config/raycast/`, which is also outside the
  allowlist. The compile and typecheck succeed in the sandbox, and only the
  install step fails.
- The sandbox denies reads of any file named `credentials.*`. Some packages
  ship such a file (keytar had `credentials.h`), and this can block
  `rm -rf node_modules`.
