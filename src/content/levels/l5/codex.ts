// Codex entries first taught in level 5 (terminals and chips). Facts: docs/claude-code-reference.md §5.
import type { CodexEntry } from '../../types';

export const codex: CodexEntry[] = [
  // ───────────── t1 · Subagents ─────────────
  {
    id: 'concept-subagent',
    category: 'concepts',
    title: 'Субагент',
    summary: 'Помощник со своим контекстом, системным промптом и набором инструментов: делает работу отдельно и возвращает сводку.',
    details:
      'Большое чтение остаётся в контексте субагента, а в твой разговор приходит только итог. Поэтому расследования, поиск по тысячам файлов и проверки удобно поручать субагентам.\n\nClaude зовёт субагента сам, если задача подходит под его description. Субагенты работают и на переднем плане, и в фоне.',
    level: 5,
  },
  {
    id: 'file-claude-agents',
    category: 'files',
    title: '.claude/agents/',
    syntax: '.claude/agents/<имя>.md',
    summary: 'Файл субагента: шапка с name и description, ниже — его системный промпт.',
    details:
      'Необязательные поля шапки: tools (какие инструменты можно), model (sonnet, opus, haiku, fable или inherit), permissionMode, maxTurns и другие. Личные субагенты лежат в ~/.claude/agents/. Правки подхватываются без перезапуска.\n\nМастера /agents больше нет: попроси Claude создать субагента словами или напиши файл сам.',
    level: 5,
  },
  {
    id: 'concept-agent-mention',
    category: 'concepts',
    title: 'Вызов субагента',
    syntax: '@agent-<имя>',
    summary: 'Упоминание, которое поручает задачу конкретному субагенту, например @agent-vent-inspector найди причину.',
    details:
      'Из меню @ он вставляется как @"vent-inspector (agent)". Можно и словами: «используй субагента vent-inspector». А claude --agent <имя> запускает с субагентом всю сессию.',
    level: 5,
  },

  // ───────────── t2 · Headless ─────────────
  {
    id: 'cli-print',
    category: 'cli',
    title: 'claude -p',
    syntax: 'claude -p "<запрос>"',
    summary: 'Headless-режим: Claude отвечает на один запрос, печатает ответ и завершается.',
    details:
      'Длинная форма — --print. При успехе код выхода 0, поэтому вызов удобно ставить в скрипты, расписания и CI.\n\nОкна разрешений в -p нет, поэтому нужные команды разрешают заранее (--allowedTools). Продолжить разговор: claude -p "…" --continue или --resume <session_id>.',
    level: 5,
  },
  {
    id: 'concept-pipe',
    category: 'concepts',
    title: 'Пайп в Claude',
    syntax: 'cat <файл> | claude -p "<вопрос>" > <отчёт>',
    summary: 'Знак | передаёт вывод одной команды на вход claude -p, а > сохраняет ответ в файл.',
    details: 'Так Claude получает журналы, вывод тестов или diff. На вход можно подать до 10 МБ.',
    level: 5,
  },
  {
    id: 'cli-output-format',
    category: 'cli',
    title: '--output-format',
    syntax: '--output-format text | json | stream-json',
    summary: 'Формат ответа в -p: text — обычный текст (по умолчанию), json — один объект, stream-json — поток строк.',
    details:
      'В json есть поля result (ответ), session_id и total_cost_usd. Достать одно поле: … | jq -r \'.result\'.\n\nstream-json — JSON по строке на событие; документация ставит его вместе с --verbose.',
    level: 5,
  },
  {
    id: 'cli-allowed-tools',
    category: 'cli',
    title: '--allowedTools',
    syntax: '--allowedTools "Bash(npm run *),Read"',
    summary: 'Заранее разрешает инструменты и команды — в формате правил разрешений.',
    details:
      'Нужен прежде всего в -p, где спросить разрешения некого. Разрешай ровно то, что нужно задаче.\n\n--permission-mode dontAsk запрещает всё, что не разрешено заранее. --dangerously-skip-permissions по справке — только для песочниц без интернета.',
    level: 5,
  },

  // ───────────── t3 · Parallel work ─────────────
  {
    id: 'cli-worktree',
    category: 'cli',
    title: 'claude --worktree',
    syntax: 'claude --worktree <имя>',
    summary: 'Создаёт отдельную рабочую копию .claude/worktrees/<имя>/ на ветке worktree-<имя> и открывает в ней сессию.',
    details:
      'Короткая форма — -w. Без имени Claude придумает своё, вроде bright-running-fox. Для второй задачи — второй терминал и другое имя.\n\nПапку .claude/worktrees/ добавь в .gitignore. При выходе чистую безымянную копию Claude удалит, а про копию с изменениями спросит. Вернуться: claude --worktree <имя> --resume.',
    level: 5,
  },
  {
    id: 'key-ctrl-b',
    category: 'keys',
    title: 'Ctrl+B',
    syntax: 'Ctrl+B',
    summary: 'Отправляет в фон идущую команду или субагента — сессия освобождается, работа продолжается.',
    details: 'В tmux нажимай дважды. Можно и попросить Claude запустить команду в фоне словами.',
    level: 5,
  },
  {
    id: 'slash-tasks',
    category: 'slash',
    title: '/tasks',
    syntax: '/tasks',
    summary: 'Список фоновой работы: что сейчас идёт; отсюда же её можно остановить.',
    details: 'Другое имя — /bashes. Не путай с /background (/bg): та команда отправляет в фон весь разговор.',
    level: 5,
  },

  // ───────────── t4 · Final exam ─────────────
  {
    id: 'concept-operator-session',
    category: 'concepts',
    title: 'Сессия оператора',
    syntax: 'план → правка → проверка → коммит',
    summary: 'Порядок большого ремонта: сначала план, потом правка, проверка и коммит с твоим разрешением.',
    details:
      'Сессия в папке проекта, Shift+Tab до plan mode, запрос с @файлом. Одобрение плана задаёт режим для правок. Проверку можно поручить субагенту.\n\nПеред необратимым шагом — Shift+Tab до manual mode и разовое Yes.',
    level: 5,
  },

  // ───────────── t5 · GitHub ─────────────
  {
    id: 'slash-install-github-app',
    category: 'slash',
    title: '/install-github-app',
    syntax: '/install-github-app',
    summary: 'Подключает Claude к репозиторию на github.com: ставит приложение, сохраняет ключ в секретах и открывает PR с workflow.',
    details:
      'Ключ ложится в секрет ANTHROPIC_API_KEY (или CLAUDE_CODE_OAUTH_TOKEN). Бот заработает, когда PR с workflow сольют. Главный шаг workflow: uses: anthropics/claude-code-action@v1.',
    level: 5,
  },
  {
    id: 'concept-claude-in-github',
    category: 'concepts',
    title: '@claude в GitHub',
    syntax: '@claude <просьба>',
    summary: 'Комментарий с @claude в issue или PR зовёт бота: он читает обсуждение и берётся за работу.',
    details:
      'Например: @claude implement this feature based on the issue description. Бот работает в GitHub Actions. Его PR проверяют, как работу коллеги: если не можешь проверить — не выпускай.',
    level: 5,
  },

  // ───────────── chips ─────────────
  {
    id: 'concept-builtin-subagents',
    category: 'concepts',
    title: 'Встроенные субагенты',
    syntax: 'Explore · Plan · general-purpose',
    summary: 'Субагенты, которые есть всегда: Explore ищет по коду только на чтение, Plan помогает планировать, general-purpose — на все руки.',
    details: 'У Explore три глубины поиска: quick, medium и very thorough.',
    level: 5,
  },
  {
    id: 'cli-max-turns',
    category: 'cli',
    title: '--max-turns',
    syntax: 'claude -p "<запрос>" --max-turns 3',
    summary: 'Ограничивает число ходов Claude в headless-режиме.',
    details: 'Работает только с -p. Флаг описан в документации, но не показан в claude --help.',
    level: 5,
  },
  {
    id: 'cli-bg',
    category: 'cli',
    title: 'claude --bg',
    syntax: 'claude --bg "<задача>"',
    summary: 'Запускает целую сессию в фоне и печатает её id.',
    details:
      'claude agents показывает фоновые сессии: Needs input, Working, Completed. claude attach <id> подключается к сессии. Внутри сессии /background (/bg) отправляет в фон текущий разговор. Пока это research preview; с -p флаг не сочетается.',
    level: 5,
  },
  {
    id: 'file-worktreeinclude',
    category: 'files',
    title: '.worktreeinclude',
    syntax: '.worktreeinclude',
    summary: 'Список файлов вроде .env, которые копируются в каждую новую worktree.',
    details: 'Worktree — чистая копия репозитория: файлы вне git туда не попадают, а зависимости в ней ставят заново.',
    level: 5,
  },
];
