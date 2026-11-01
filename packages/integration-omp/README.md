# @b-apm/integration-omp

> **UNSTABLE:** Early public release. APIs and on-disk layouts may change without a major bump. Not production-ready.

Интеграция [Omp](https://omp.sh) (кодинг-агент omp.sh) для bapm. Кладёт skills, prompt-команды и MCP туда, где Omp их реально читает, по документации omp.sh.

## Куда раскладывает

| Артефакт bapm | Куда уходит у Omp                                       | Основание                                                                                                                                                |
| ------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| skills        | `.agents/skills/<name>/SKILL.md`                        | Omp обнаруживает стандартные Agent Skills-локации `.agents/skills` (walk cwd → корень репозитория); тот же каталог используют cursor/windsurf/pi-таргеты |
| commands      | `.omp/prompts/<name>.md`                                | Prompt-шаблоны Omp = slash-команды; имя команды = имя файла, из frontmatter значим только `description`; лишние ключи фильтруются общим allowlist        |
| instructions  | skip → диагностика `OMP_INSTRUCTION_SKIPPED`            | У Omp нет каталога per-file rules; инструкции доходят через `bapm compile` → `AGENTS.md` (context file)                                                  |
| agents, hooks | skip → `OMP_AGENT_UNSUPPORTED` / `OMP_HOOK_UNSUPPORTED` | Не является записываемым layout этого таргета                                                                                                            |
| MCP           | `.omp/mcp.json` (`mcpServers`)                          | Проектный конфиг Omp; user-level `~/.omp/agent/mcp.json` не трогаем                                                                                      |
| compile       | `AGENTS.md` (корень)                                    | Omp читает AGENTS.md из cwd и родительских каталогов                                                                                                     |

Detect: наличие каталога `.omp/` в проекте.

## MCP

`configureMcp` пишет в `.omp/mcp.json`, сохраняя существующие серверы:

- `stdio` → `{ type: "stdio", command, args, env, cwd }`;
- streamable HTTP → `{ type: "http", url }`;
- **`sse` → `{ type: "sse", url }`** — Omp поддерживает легаси-транспорт SSE нативно (в отличие от Pi, где sse fail-closed).

## Agent Plugins (portable v1)

| Компонент плагина | Что делает таргет                                                                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `skills/`         | копия каталога в `.agents/skills/<name>/` (формат Agent Skills = то, что Omp реализует)                                                                                   |
| `mcp.json`        | адаптер полей в `.omp/mcp.json`: `stdio` → `type: "stdio"`, `streamable-http` → `type: "http"`, `sse` → `type: "sse"`; прочие транспорты → диагностика, сервер не пишется |
| `commands`        | `.omp/prompts/<name>.md`, frontmatter фильтруется                                                                                                                         |
| `hooks`           | skip + диагностика (хуки Omp принадлежат конфигурации, не этому таргету)                                                                                                  |

## Использование

```bash
bunx github:dealenx/bapm install --target omp
# или в bapm.yml:
# targets:
#   omp: "@b-apm/integration-omp"
# active:
#   target: omp
```

Проект должен содержать `.omp/` (auto-detect) либо target форсируется флагом `--target omp` / `active`.

## Ссылки

- Omp skills: <https://omp.sh/docs/skills>
- Omp MCP: <https://omp.sh/docs/mcp>
- Omp context files: <https://omp.sh/docs/context-files>
- Omp prompt templates: <https://omp.sh/docs/prompt-templates>
