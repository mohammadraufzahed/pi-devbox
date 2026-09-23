# pi-devbox

A [pi coding agent](https://github.com/earendil-works/pi) extension that
gives the agent first-class tools for working with
[**devbox**](https://www.jetify.com/devbox) environments — so the agent
uses the project's declared toolchain instead of guessing at the host.

## Tools

| Tool | What it does |
|---|---|
| `devbox_info` | Detect `devbox.json`, list declared packages & services |
| `devbox_config` | Parsed `devbox.json` — packages, env, scripts, includes (JSON) |
| `devbox_run` | `devbox run -- sh -c <cmd>` — builds/tests inside the project env |
| `devbox_script` | Run a named `shell.scripts` entry from `devbox.json` |
| `devbox_add` / `devbox_remove` | Mutate `devbox.json` packages |
| `devbox_search` | `devbox search` nixpkgs before adding |
| `devbox_services` | `start` / `stop` / `restart` / `ls` declared services (db, redis, meilisearch...) |
| `devbox_env` | Env vars inside the devbox env (`MYSQL_UNIX_PORT`, `REDIS_HOST`, ...), optional filter |
| `devbox_generate` | `devbox generate dockerfile|devcontainer|direnv` |
| `devbox_update` | `devbox update` — bump package pins |
| `devbox_init` | Scaffold `devbox.json` (+ initial packages) |

Prompt guidelines nudge the agent to prefer `devbox_run` over `bash`
whenever a `devbox.json` exists — the host may lack php/composer/etc.
while devbox provides them deterministically.

## Install

```bash
# as a pi package (recommended) — pinned to a release tag
pi install git:github.com/mohammadraufzahed/pi-devbox@v2.0.0

# or try it for one run
pi -e git:github.com/mohammadraufzahed/pi-devbox

# or manual — drop the extension file in place
mkdir -p ~/.pi/agent/extensions/pi-devbox
curl -fsSL https://raw.githubusercontent.com/mohammadraufzahed/pi-devbox/main/extensions/index.ts \
  -o ~/.pi/agent/extensions/pi-devbox/extensions/index.ts
```

Then enable the tools: `--tools read,bash,devbox_info,devbox_run,devbox_add,devbox_remove,devbox_services,devbox_init`
(or leave default tools on — extension tools are enabled automatically).

## Requirements

- `devbox` CLI on PATH (https://www.jetify.com/devbox/docs/installing_devbox/)
- pi ≥ 0.87 (extension API + jiti — no build step, plain `.ts`)

## Example session

```text
pi -p "add a users table migration and run the test suite"
# agent: devbox_info → sees php81 + mysql84 declared
#        devbox_services start → mysql up
#        devbox_run "php artisan migrate && php artisan test"
#        devbox_services stop
```

## License

MIT
