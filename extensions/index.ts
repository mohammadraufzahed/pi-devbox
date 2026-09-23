/**
 * pi-devbox — devbox tools for the pi coding agent.
 *
 * Lets the agent work inside the project's devbox environment instead of
 * guessing at the host toolchain:
 *
 *   devbox_info      — detect devbox.json, list packages & services
 *   devbox_config    — parsed devbox.json: packages, env, scripts, includes
 *   devbox_run       — run a command via `devbox run` (project toolchain)
 *   devbox_script    — run a named script declared in devbox.json
 *   devbox_add       — add packages to devbox.json
 *   devbox_remove    — remove packages
 *   devbox_search    — search nixpkgs for packages to add
 *   devbox_services  — start/stop/ls/restart declared services (db, redis, ...)
 *   devbox_env       — print environment variables inside the devbox env
 *   devbox_generate  — `devbox generate` (dockerfile, devcontainer, direnv)
 *   devbox_update    — `devbox update` — bump package pins
 *   devbox_init      — scaffold devbox.json for a non-devbox project
 *
 * Load: pi --extension /path/to/pi-devbox/index.ts
 * or drop this file in .pi/extensions/ (project) or
 * ~/.pi/agent/extensions/ (global).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Type } from "typebox";

const MAX_OUT = 8000;
const DEFAULT_TIMEOUT = 300_000;

interface RunResult {
	code: number;
	out: string;
	err: string;
	timedOut: boolean;
}

function run(
	args: string[],
	cwd: string,
	timeout = DEFAULT_TIMEOUT,
): Promise<RunResult> {
	return new Promise((resolve) => {
		execFile(
			"devbox",
			args,
			{ cwd, timeout, maxBuffer: 16 * 1024 * 1024 },
			(err, stdout, stderr) => {
				resolve({
					code:
						err && typeof (err as { code?: number }).code === "number"
							? ((err as { code?: number }).code ?? 1)
							: err
								? 1
								: 0,
					out: String(stdout ?? ""),
					err: String(stderr ?? ""),
					timedOut: Boolean((err as { killed?: boolean } | null)?.killed),
				});
			},
		);
	});
}

function text(r: RunResult): string {
	const body = (r.out + (r.err ? "\n--- stderr ---\n" + r.err : "")).trim();
	const trunc =
		body.length > MAX_OUT
			? body.slice(-MAX_OUT) + `\n\n[truncated — ${body.length} chars total]`
			: body;
	return `exit ${r.code}${r.timedOut ? " (timeout)" : ""}\n${trunc || "(no output)"}`;
}

export default function piDevbox(pi: ExtensionAPI) {
	const hasDevboxJson = (cwd: string) =>
		existsSync(join(cwd, "devbox.json"));

	const noDevbox = {
		content: [
			{
				type: "text" as const,
				text: "No devbox.json in this directory — the project is not a devbox environment. Use devbox_init to scaffold one, or plain shell tools for host commands.",
			},
		],
		details: { devbox: false },
	};

	pi.registerTool({
		name: "devbox_info",
		label: "Devbox Info",
		description:
			"Inspect the devbox environment of the current project: whether devbox.json exists, which packages and services are declared, and the devbox version.",
		promptSnippet: "Inspect the project's devbox environment",
		promptGuidelines: [
			"Call devbox_info first when working in an unfamiliar project to learn the available toolchain and services.",
		],
		parameters: Type.Object({}),
		async execute(_id, _params, _signal, _onUpdate, ctx) {
			if (!hasDevboxJson(ctx.cwd)) return noDevbox;
			const r = await run(["ls", "--json"], ctx.cwd, 30_000);
			return {
				content: [{ type: "text", text: text(r) }],
				details: { devbox: true, code: r.code },
			};
		},
	});

	pi.registerTool({
		name: "devbox_config",
		label: "Devbox Config",
		description:
			"Show the parsed devbox.json: declared packages (with versions), env vars, shell scripts, included plugins. Richer than devbox_info — call this to plan environment changes.",
		promptSnippet: "Show parsed devbox.json contents",
		parameters: Type.Object({}),
		async execute(_id, _params, _signal, _onUpdate, ctx) {
			const path = join(ctx.cwd, "devbox.json");
			if (!existsSync(path)) return noDevbox;
			try {
				const raw = await readFile(path, "utf-8");
				const cfg = JSON.parse(raw) as Record<string, unknown>;
				const summary = {
					packages: cfg.packages ?? {},
					env: cfg.env ?? {},
					include: cfg.include ?? [],
					scripts:
						(cfg.shell as { scripts?: unknown } | undefined)?.scripts ??
						{},
				};
				return {
					content: [
						{ type: "text", text: JSON.stringify(summary, null, 2) },
					],
					details: { devbox: true, config: summary },
				};
			} catch (e) {
				return {
					content: [
						{
							type: "text",
							text: `Failed to parse devbox.json: ${e}`,
						},
					],
					details: { devbox: true, error: String(e) },
				};
			}
		},
	});

	pi.registerTool({
		name: "devbox_run",
		label: "Devbox Run",
		description:
			"Run a shell command inside the project's devbox environment (`devbox run -- sh -c <command>`). The project's declared packages and env vars are available — use this instead of bash for builds, tests, and project scripts.",
		promptSnippet: "Run a command in the project's devbox environment",
		promptGuidelines: [
			"Prefer devbox_run over bash whenever the project has a devbox.json — the host may lack the right toolchain.",
			"For long-running services use devbox_services instead.",
		],
		parameters: Type.Object({
			command: Type.String({ description: "Shell command to run" }),
			timeout_ms: Type.Optional(
				Type.Number({ description: "Timeout in ms (default 300000)" }),
			),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const r = await run(
				["run", "--quiet", "--", "sh", "-c", params.command],
				ctx.cwd,
				params.timeout_ms ?? DEFAULT_TIMEOUT,
			);
			return {
				content: [{ type: "text", text: text(r) }],
				details: { code: r.code },
			};
		},
	});

	pi.registerTool({
		name: "devbox_script",
		label: "Devbox Script",
		description:
			"Run a named script declared in devbox.json shell.scripts (`devbox run <name>`). Use devbox_config to see which scripts exist.",
		promptSnippet: "Run a devbox.json script by name",
		promptGuidelines: [
			"Prefer named scripts (devbox_script) over ad-hoc devbox_run commands when the project declares them.",
		],
		parameters: Type.Object({
			name: Type.String({ description: "Script name from devbox.json" }),
			args: Type.Optional(
				Type.Array(Type.String(), {
					description: "Extra arguments appended to the script",
				}),
			),
			timeout_ms: Type.Optional(Type.Number()),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const r = await run(
				["run", "--quiet", params.name, ...(params.args ?? [])],
				ctx.cwd,
				params.timeout_ms ?? DEFAULT_TIMEOUT,
			);
			return {
				content: [{ type: "text", text: text(r) }],
				details: { code: r.code },
			};
		},
	});

	pi.registerTool({
		name: "devbox_add",
		label: "Devbox Add",
		description:
			"Add packages to the project's devbox.json (e.g. php81, nodejs_24, mysql84). Equivalent to `devbox add <pkg>...`. Use devbox_search first when unsure of the package name.",
		promptSnippet: "Add packages to devbox.json",
		parameters: Type.Object({
			packages: Type.Array(Type.String(), {
				description: 'Nix package names, e.g. ["php81", "redis"]',
				minItems: 1,
			}),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const r = await run(["add", ...params.packages], ctx.cwd, 300_000);
			return {
				content: [{ type: "text", text: text(r) }],
				details: { code: r.code },
			};
		},
	});

	pi.registerTool({
		name: "devbox_remove",
		label: "Devbox Remove",
		description: "Remove packages from the project's devbox.json.",
		promptSnippet: "Remove packages from devbox.json",
		parameters: Type.Object({
			packages: Type.Array(Type.String(), { minItems: 1 }),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const r = await run(["rm", ...params.packages], ctx.cwd, 120_000);
			return {
				content: [{ type: "text", text: text(r) }],
				details: { code: r.code },
			};
		},
	});

	pi.registerTool({
		name: "devbox_search",
		label: "Devbox Search",
		description:
			"Search nixpkgs for packages available to devbox (`devbox search`). Use before devbox_add when unsure of the exact package name or version.",
		promptSnippet: "Search available devbox/nix packages",
		parameters: Type.Object({
			query: Type.String({ description: "Package name to search" }),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const r = await run(["search", params.query], ctx.cwd, 60_000);
			return {
				content: [{ type: "text", text: text(r) }],
				details: { code: r.code },
			};
		},
	});

	pi.registerTool({
		name: "devbox_services",
		label: "Devbox Services",
		description:
			"Manage the project's devbox services (mysql, redis, php-fpm, ... whatever devbox.json declares): start, stop, restart, or list.",
		promptSnippet: "Manage devbox services",
		promptGuidelines: [
			"Start services before running tests that need a database; stop them when done.",
		],
		parameters: Type.Object({
			action: Type.Union(
				[
					Type.Literal("start"),
					Type.Literal("stop"),
					Type.Literal("restart"),
					Type.Literal("ls"),
				],
				{ description: "Service action" },
			),
			services: Type.Optional(
				Type.Array(Type.String(), {
					description: "Specific services (default: all)",
				}),
			),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const r = await run(
				["services", params.action, ...(params.services ?? [])],
				ctx.cwd,
				180_000,
			);
			return {
				content: [{ type: "text", text: text(r) }],
				details: { code: r.code },
			};
		},
	});

	pi.registerTool({
		name: "devbox_env",
		label: "Devbox Env",
		description:
			"Print environment variables inside the devbox environment (`devbox run -- env`). Useful for service endpoints (MYSQL_UNIX_PORT, REDIS_HOST, ...) injected by plugins.",
		promptSnippet: "Show env vars inside the devbox environment",
		parameters: Type.Object({
			pattern: Type.Optional(
				Type.String({
					description:
						"Optional case-insensitive substring filter, e.g. 'mysql'",
				}),
			),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const r = await run(
				["run", "--quiet", "--", "env"],
				ctx.cwd,
				60_000,
			);
			let body = r.out;
			if (params.pattern) {
				const p = params.pattern.toLowerCase();
				body = body
					.split("\n")
					.filter((l) => l.toLowerCase().includes(p))
					.join("\n");
			}
			return {
				content: [{ type: "text", text: text({ ...r, out: body }) }],
				details: { code: r.code },
			};
		},
	});

	pi.registerTool({
		name: "devbox_generate",
		label: "Devbox Generate",
		description:
			"Generate artifacts from devbox.json: 'dockerfile', 'devcontainer', or 'direnv' (`devbox generate <kind>`).",
		promptSnippet: "Generate Dockerfile/devcontainer/direnv from devbox.json",
		parameters: Type.Object({
			kind: Type.Union(
				[
					Type.Literal("dockerfile"),
					Type.Literal("devcontainer"),
					Type.Literal("direnv"),
				],
				{ description: "Artifact to generate" },
			),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const r = await run(["generate", params.kind], ctx.cwd, 120_000);
			return {
				content: [{ type: "text", text: text(r) }],
				details: { code: r.code },
			};
		},
	});

	pi.registerTool({
		name: "devbox_update",
		label: "Devbox Update",
		description:
			"Update package pins in devbox.json to their latest versions (`devbox update`). Optionally restrict to specific packages.",
		promptSnippet: "Update devbox package pins",
		promptGuidelines: [
			"Run the test suite after devbox_update — pin bumps can break builds.",
		],
		parameters: Type.Object({
			packages: Type.Optional(
				Type.Array(Type.String(), {
					description: "Specific packages (default: all)",
				}),
			),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const r = await run(
				["update", ...(params.packages ?? [])],
				ctx.cwd,
				300_000,
			);
			return {
				content: [{ type: "text", text: text(r) }],
				details: { code: r.code },
			};
		},
	});

	pi.registerTool({
		name: "devbox_init",
		label: "Devbox Init",
		description:
			"Scaffold a devbox.json in a project that doesn't have one (`devbox init`), optionally adding initial packages.",
		promptSnippet: "Initialize devbox in the project",
		parameters: Type.Object({
			packages: Type.Optional(
				Type.Array(Type.String(), {
					description: 'Initial packages, e.g. ["nodejs_24"]',
				}),
			),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const r = await run(["init"], ctx.cwd, 60_000);
			let addText = "";
			if (r.code === 0 && params.packages?.length) {
				const add = await run(
					["add", ...params.packages],
					ctx.cwd,
					300_000,
				);
				addText = "\n\nadd:\n" + text(add);
			}
			return {
				content: [{ type: "text", text: text(r) + addText }],
				details: { code: r.code },
			};
		},
	});
}
