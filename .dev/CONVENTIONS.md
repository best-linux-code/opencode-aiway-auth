# opencode-aiway-auth Conventions

## 1. Source Alignment

Follow the conventions of OpenCode source and the `opencode-anthropic-claude-auth` reference plugin.

## 2. Language and Tooling

- TypeScript
- Bun-compatible project structure
- build output in `dist/`
- tests in `test/`

## 3. Coding Style

1. avoid `any`
2. avoid `@ts-ignore` and `@ts-expect-error`
3. prefer `const`
4. prefer short single-word local names
5. prefer early return over `else`
6. keep functions compact

## 4. Naming

Preferred short names: `cfg`, `opts`, `res`, `body`, `model`, `auth`, `state`, `url`, `key`

## 5. File Layout

### `src/index.ts`

- export the plugin symbol only

### `src/plugin.ts`

- auth loader, auth methods, model mapping, config writing
- provider patching logic

### `src/limits.ts`

- built-in token limits table
- default fallback values
- exported as a simple Map or Record

## 6. Config Write Rules

- only update config for the `aiway` provider path
- merge, never overwrite
- never delete unrelated provider or plugin config

## 7. Logging Rules

- log to `/tmp/opencode-aiway-auth.log`
- never log API keys or bearer tokens
- concise one-line log entries

## 8. Testing Rules

- prefer real HTTP interactions
- remote checks on `http://192.168.77.88` are part of done criteria
