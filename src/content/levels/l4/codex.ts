// Codex entries first taught in level 4 (terminals and chips). Facts: docs/claude-code-reference.md §4.
import type { CodexEntry } from '../../types';

export const codex: CodexEntry[] = [
  // ───────────── t1 · MCP ─────────────
  {
    id: 'concept-mcp-server',
    category: 'concepts',
    title: 'MCP-сервер',
    summary: 'Переходник, через который Claude получает инструменты и данные другой системы: датчиков, баз, трекеров.',
    details:
      'Без MCP Claude видит только папку проекта и командную строку. С MCP он сам вызывает инструменты сервера — их имена выглядят как mcp__<сервер>__<инструмент>.\n\nЭти имена пригодятся в правилах разрешений (mcp__puppeteer__* — все инструменты сервера) и в matcher хуков (mcp__.*).',
    level: 4,
  },
  {
    id: 'cli-mcp-add',
    category: 'cli',
    title: 'claude mcp add',
    syntax: 'claude mcp add --transport http <имя> <адрес>',
    summary: 'Подключает удалённый MCP-сервер по HTTP; при успехе печатает строку Added ….',
    details:
      'Флаги ставят до имени сервера. HTTP — рекомендуемый транспорт; SSE устарел, а HTTP сам откатывается на него, когда нужно.\n\nСервер с токеном: --header "Authorization: Bearer <токен>". Где записать сервер, решает --scope.',
    level: 4,
  },
  {
    id: 'concept-mcp-scopes',
    category: 'concepts',
    title: 'Scope MCP-сервера',
    syntax: '--scope local | project | user',
    summary: 'Кому доступен сервер: только тебе в этом проекте, всей команде проекта или тебе во всех проектах.',
    details:
      'local (по умолчанию) и user хранятся в ~/.claude.json, project — в .mcp.json в корне проекта. Короткая форма флага: -s.\n\nЕсли одно имя определено дважды, главнее local, потом project, потом user, потом плагины.',
    level: 4,
  },
  {
    id: 'file-mcp-json',
    category: 'files',
    title: '.mcp.json',
    syntax: '{"mcpServers": {"<имя>": {"type": "http", "url": "<адрес>"}}}',
    summary: 'Файл MCP-серверов проекта: его коммитят, и серверы появляются у всей команды.',
    details:
      'Понимает ${VAR} и ${VAR:-default}: токены остаются в переменных окружения, а не в git.\n\nСерверы из .mcp.json нужно одобрить в интерактивной сессии — до этого claude mcp list показывает ⏸ Pending approval. Чужой .mcp.json сначала прочти.',
    level: 4,
  },
  {
    id: 'cli-mcp-list',
    category: 'cli',
    title: 'claude mcp list',
    syntax: 'claude mcp list',
    summary: 'Показывает все MCP-серверы и их статус.',
    details:
      'Статусы: ✔ Connected, ! Needs authentication, ✘ Failed to connect, ⏸ Pending approval. Рядом живут claude mcp get <имя>, remove <имя> и login <имя>.',
    level: 4,
  },
  {
    id: 'slash-mcp',
    category: 'slash',
    title: '/mcp',
    syntax: '/mcp',
    summary: 'Список MCP-серверов прямо в сессии: статус, число инструментов, вход через браузер.',
    details: 'Там же Re-authenticate, Clear authentication, Disable и Reconnect. /mcp reconnect all переподключает все упавшие серверы разом.',
    level: 4,
  },

  // ───────────── t2 · Skills ─────────────
  {
    id: 'file-skill-md',
    category: 'files',
    title: 'SKILL.md',
    syntax: '.claude/skills/<имя>/SKILL.md',
    summary: 'Скилл — рецепт для повторяющейся задачи: шапка с именем и описанием, ниже — шаги.',
    details:
      'Проектные скиллы лежат в .claude/skills/ и попадают в git, личные — в ~/.claude/skills/. Правки подхватываются сразу.\n\nСтарые команды из .claude/commands/ — тоже скиллы; при совпадении имён побеждает скилл. /skills показывает все скиллы.',
    level: 4,
  },
  {
    id: 'slash-skill-run',
    category: 'slash',
    title: 'Запуск скилла',
    syntax: '/<имя> <аргументы>',
    summary: 'Запускает скилл по имени, например /calibrate 7 или /fix-issue 123.',
    details: 'Claude может взять скилл и сам — если задача подходит под его description. Скиллы видны в меню, которое открывает /.',
    level: 4,
  },
  {
    id: 'concept-skill-arguments',
    category: 'concepts',
    title: '$ARGUMENTS',
    syntax: '$ARGUMENTS · $0 · $1',
    summary: 'Подстановка в SKILL.md: на её место встаёт всё, что написано после имени скилла.',
    details: '$0, $1 — отдельные аргументы, счёт с нуля. Если подстановки в рецепте нет, аргументы допишутся в конец как ARGUMENTS: <значение>.',
    level: 4,
  },
  {
    id: 'concept-skill-manual-only',
    category: 'concepts',
    title: 'Только ручной запуск',
    syntax: 'disable-model-invocation: true',
    summary: 'Строка в шапке SKILL.md: скилл запускается только твоей командой, сам Claude его не возьмёт.',
    details: 'Для рецептов с последствиями: деплой, коммит, рассылка, остановка оборудования.',
    level: 4,
  },

  // ───────────── t3 · Hooks ─────────────
  {
    id: 'concept-hooks',
    category: 'concepts',
    title: 'Хук',
    syntax: '"hooks": { "PostToolUse": [ … ] }',
    summary: 'Команда, которая запускается сама на событии сессии — каждый раз, без спроса и без забывчивости.',
    details:
      'CLAUDE.md — совет, хук — гарантия. Хуки пишут в любом файле настроек (в .claude/settings.json — для всей команды), в плагинах и в шапке скиллов и субагентов.\n\nТипы обработчиков: command, http, mcp_tool, prompt, agent. Путь к проекту в скрипте — $CLAUDE_PROJECT_DIR.',
    level: 4,
  },
  {
    id: 'concept-hook-events',
    category: 'concepts',
    title: 'События хуков',
    syntax: 'PreToolUse · PostToolUse · UserPromptSubmit · SessionStart · Stop',
    summary: 'Момент, когда срабатывает хук: до инструмента, после него, при отправке запроса, при старте сессии и другие.',
    details:
      'PreToolUse может запретить вызов. PostToolUse — для проверок после правок. Есть ещё PermissionRequest, Notification, SubagentStop, PreCompact, SessionEnd и другие.',
    level: 4,
  },
  {
    id: 'concept-hook-matcher',
    category: 'concepts',
    title: 'matcher',
    syntax: '"matcher": "Edit|Write"',
    summary: 'Фильтр хука по имени инструмента: Edit|Write — правки файлов, Bash — команды, mcp__.* — инструменты MCP.',
    details: 'Для SessionStart matcher — это причина старта: startup, resume, clear, compact или fork.',
    level: 4,
  },
  {
    id: 'concept-hook-exit-2',
    category: 'concepts',
    title: 'Exit 2 в хуке',
    syntax: 'exit 2',
    summary: 'Код выхода, которым хук блокирует действие: PreToolUse отменяет вызов, а текст из stderr Claude получает как причину.',
    details:
      '0 — успех. 2 — блокирующая ошибка (в UserPromptSubmit отклоняет запрос). Любой другой код — неблокирующая ошибка: появится уведомление <hook name> hook error, а работа продолжится.',
    level: 4,
  },
  {
    id: 'slash-hooks',
    category: 'slash',
    title: '/hooks',
    syntax: '/hooks',
    summary: 'Показывает действующие хуки и файл, откуда взялся каждый. Только просмотр.',
    details: 'Раньше через /hooks хуки редактировали — теперь нет. Чтобы изменить хук, правь JSON или попроси Claude.',
    level: 4,
  },

  // ───────────── t4 · Settings and plugins ─────────────
  {
    id: 'file-settings-layers',
    category: 'files',
    title: 'Файлы настроек',
    syntax: '~/.claude/settings.json · .claude/settings.json · .claude/settings.local.json',
    summary: 'Три слоя настроек: твои личные, общие для проекта (в git) и личные для проекта (вне git).',
    details:
      'Над ними — managed-настройки организации. Файлы — строгий JSON: без комментариев и висячих запятых.\n\nMCP-серверы живут не здесь, а в ~/.claude.json и .mcp.json.',
    level: 4,
  },
  {
    id: 'concept-settings-precedence',
    category: 'concepts',
    title: 'Кто главнее в настройках',
    syntax: 'managed > флаги > local > project > user',
    summary: 'Порядок, в котором слои перебивают друг друга: чем ближе к делу, тем главнее.',
    details:
      'Флаг командной строки сильнее файлов проекта и личных, а managed-настройки организации — сильнее всего, даже флагов. Списки вроде permissions.allow не перебиваются, а складываются из всех слоёв.',
    level: 4,
  },
  {
    id: 'slash-config',
    category: 'slash',
    title: '/config',
    syntax: '/config · /config <ключ>=<значение>',
    summary: 'Открывает экран настроек; с ключ=значение — сразу ставит настройку.',
    details: 'Пишет в основном в ~/.claude/settings.json. Какие файлы настроек сейчас действуют, показывает /status — строка Setting sources.',
    level: 4,
  },
  {
    id: 'slash-plugin',
    category: 'slash',
    title: '/plugin',
    syntax: '/plugin install <плагин>@<маркетплейс>',
    summary: 'Ставит плагины — наборы скиллов, агентов, хуков и MCP-серверов.',
    details:
      '/plugin без аргументов открывает вкладки Discover, Installed, Marketplaces и Errors. При установке выбирают scope: для себя, для всех в репозитории или для себя только здесь.\n\nМаркетплейс claude-plugins-official подключён сам, другие — /plugin marketplace add owner/repo. Плагин может запускать код: ставь только то, чему доверяешь. Если видишь Run /reload-plugins to activate. — выполни /reload-plugins.',
    level: 4,
  },
  {
    id: 'concept-plugin-skills',
    category: 'concepts',
    title: 'Скиллы плагина',
    syntax: '/<плагин>:<скилл>',
    summary: 'Скиллы из плагинов пишутся с приставкой — именем плагина, например /commit-commands:commit.',
    level: 4,
  },

  // ───────────── chips ─────────────
  {
    id: 'concept-mcp-resources',
    category: 'concepts',
    title: 'Ресурсы MCP',
    syntax: '@<сервер>:<протокол>://<путь>',
    summary: 'Данные MCP-сервера упоминают через @, как файл, например @github:issue://123.',
    details: 'Промпты MCP-серверов появляются в меню / как /сервер:промпт (MCP), а запускаются так: /mcp__github__pr_review 456.',
    level: 4,
  },
  {
    id: 'cli-mcp-add-stdio',
    category: 'cli',
    title: 'Локальный MCP-сервер',
    syntax: 'claude mcp add --transport stdio <имя> -- <команда>',
    summary: 'Подключает сервер-программу на твоём компьютере; всё после -- — это команда сервера.',
    details:
      'stdio — транспорт по умолчанию. Переменные окружения: --env API_KEY=xxx. Готовый JSON добавляют через claude mcp add-json <имя> \'<json>\' — это единственный способ для WebSocket-серверов.',
    level: 4,
  },
  {
    id: 'concept-skill-inject',
    category: 'concepts',
    title: 'Вывод команды в скилле',
    syntax: '!`<команда>`',
    summary: 'Такая строка в SKILL.md заменяется выводом команды ещё до того, как Claude прочтёт рецепт.',
    details: 'Например, !`git diff HEAD` даёт рецепту свежий diff при каждом запуске.',
    level: 4,
  },
  {
    id: 'concept-hook-session-start',
    category: 'concepts',
    title: 'Хук SessionStart',
    syntax: '"SessionStart"',
    summary: 'Хук при старте сессии: всё, что его скрипт напечатает при выходе с кодом 0, станет частью контекста.',
    details: 'Matcher для него — startup, resume, clear, compact или fork. У UserPromptSubmit так же: при коде 0 его вывод становится контекстом.',
    level: 4,
  },
];
