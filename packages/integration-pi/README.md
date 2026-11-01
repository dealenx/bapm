# @b-apm/integration-pi

Интеграция [Pi](https://pi.dev) (пи-кодинг-агент) для bapm. Кладёт skills и MCP туда, где Pi их реально читает, по документации pi.dev.

## Куда раскладывает

| Артефакт bapm | Куда уходит у Pi                                      | Основание                                                                                                                                      |
| ------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| skills        | `.agents/skills/<name>/SKILL.md`                      | Pi читает стандартные Agent Skills-локации `.agents/skills` (walk cwd → корень репозитория); тот же каталог используют cursor/windsurf-таргеты |
| commands      | `.pi/prompts/<name>.md`                               | Prompt-шаблоны Pi = slash-команды; frontmatter фильтруется до `description` / `argument-hint` / …                                              |
| instructions  | skip → диагностика `PI_INSTRUCTION_SKIPPED`           | У Pi нет каталога per-file rules; инструкции доходят через `bapm compile` → `AGENTS.md` (context file)                                         |
| agents, hooks | skip → `PI_AGENT_UNSUPPORTED` / `PI_HOOK_UNSUPPORTED` | Не является записываемым layout этого таргета                                                                                                  |
| MCP           | `.pi/mcp.json` (`mcpServers`)                         | Проектный конфиг Pi; user-level `~/.pi/agent/mcp.json` не трогаем                                                                              |
| compile       | `AGENTS.md` (корень)                                  | Pi читает AGENTS.md из cwd и родительских каталогов                                                                                            |

Detect: наличие каталога `.pi/` в проекте.

## MCP

`configureMcp` пишет в `.pi/mcp.json`, сохраняя существующие серверы:

- `stdio` → `{ command, args, env, cwd }` (тип не обязателен — Pi выводит его из `command`);
- streamable HTTP → `{ url, headers, … }`;
- **`sse` → fail-closed диагностика** — Pi отклоняет транспорт `sse` (нужен streamable HTTP).

## Agent Plugins (portable v1)

| Компонент плагина | Что делает таргет                                                                                     |
| ----------------- | ----------------------------------------------------------------------------------------------------- |
| `skills/`         | копия каталога в `.agents/skills/<name>/` (формат Agent Skills = то, что Pi реализует)                |
| `mcp.json`        | адаптер полей: `stdio` → stdio, `streamable-http` → url-entry; `sse` → диагностика, сервер не пишется |
| `commands`        | `.pi/prompts/<name>.md`, frontmatter фильтруется                                                      |
| `hooks`           | skip + диагностика (target-specific граница, как у OpenCode)                                          |

## Использование

```bash
bunx github:dealenx/bapm install --target pi
# или в bapm.yml:
# targets:
#   pi: "@b-apm/integration-pi"
# active:
#   target: pi
```

Проект должен содержать `.pi/` (auto-detect) либо target форсируется флагом `--target pi` / `active`.

## Ссылки

- Pi configuration: <https://pi.dev/docs/latest/configuration>
- Pi MCP: <https://pi.dev/docs/latest/mcp>
- Pi skills: <https://pi.dev/docs/latest/skills>
- Pi prompt templates: <https://pi.dev/docs/latest/prompt-templates>
