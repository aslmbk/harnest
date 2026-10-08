// Codex entries first taught in level 2 (terminals and chips). Facts: docs/claude-code-reference.md §2.
import type { CodexEntry } from '../../types';

export const codex: CodexEntry[] = [
  // ───────────── t1 · @ mentions and ! ─────────────
  {
    id: 'concept-at-mention',
    category: 'concepts',
    title: '@файл',
    syntax: '@src/prices.ts',
    summary: 'Упоминание кладёт в разговор весь файл: Claude не нужно его искать.',
    details:
      'Набери @ — и Claude подскажет пути. В одном сообщении можно упомянуть несколько файлов.\n\nВместе с файлом подгружаются и памятки CLAUDE.md из его папки и папок выше.',
    level: 2,
  },
  {
    id: 'concept-at-folder',
    category: 'concepts',
    title: '@папка',
    syntax: '@src/rules',
    summary: 'Упоминание папки даёт Claude список её файлов, а не их содержимое.',
    details: 'Удобно, чтобы показать, где искать. Нужные файлы Claude прочтёт сам.',
    level: 2,
  },
  {
    id: 'concept-shell-mode',
    category: 'concepts',
    title: '! — режим оболочки',
    syntax: '! npm test',
    summary: 'Строка с ! сразу запускается как команда; вывод попадает в разговор, и Claude на него отвечает.',
    details:
      'Команда идёт без запроса разрешения и вне песочницы, так что запускай только то, в чём уверен. Выйти из режима: Esc или Backspace на пустой строке.\n\nЧтобы Claude не отвечал на вывод сам, есть настройка "respondToBashCommands": false.',
    level: 2,
  },

  // ───────────── t2 · the context window ─────────────
  {
    id: 'concept-context-window',
    category: 'concepts',
    title: 'Контекст',
    summary: 'Рабочая память Claude: весь разговор, прочитанные файлы и вывод команд. Она не бесконечна.',
    details:
      'Когда контекст почти полон, разговор сжимается сам, как при /compact. После сжатия Claude заново получает корневую памятку CLAUDE.md, автопамять и план.\n\nПравило: несвязанные задачи — в разных контекстах. Если Claude дважды ошибся после поправок, лучше /clear и новая, более точная просьба.',
    level: 2,
  },
  {
    id: 'slash-context',
    category: 'slash',
    title: '/context',
    syntax: '/context',
    summary: 'Показывает заполненность контекста цветной сеткой и советует, как освободить место.',
    details: 'В сетке есть, например, строки Messages, MCP tools и Free space.',
    level: 2,
  },
  {
    id: 'slash-compact',
    category: 'slash',
    title: '/compact',
    syntax: '/compact [указания]',
    summary: 'Сжимает разговор в сводку, чтобы освободить место; указание решает, что в ней останется.',
    details: 'Пример из документации: /compact focus on the auth bug fix. Без указания сводка получится общей.',
    level: 2,
  },
  {
    id: 'slash-clear',
    category: 'slash',
    title: '/clear',
    syntax: '/clear',
    summary: 'Начинает новый разговор с пустым контекстом — между несвязанными задачами.',
    details: 'Старый разговор не пропадает: его можно вернуть через /resume.',
    level: 2,
  },

  // ───────────── t3 · CLAUDE.md layers and memory ─────────────
  {
    id: 'file-claude-md-layers',
    category: 'files',
    title: 'Слои CLAUDE.md',
    syntax: '~/.claude/CLAUDE.md · ./CLAUDE.md · ./CLAUDE.local.md',
    summary: 'Личная памятка для всех проектов, проектная для команды (в git) и локальная — твоя в одном проекте.',
    details:
      'Памятки складываются, а не перебивают друг друга. Файлы от корня диска до рабочей папки грузятся при запуске, ближний к папке — последним. Проектную можно положить и в ./.claude/CLAUDE.md.\n\nПамятки из подпапок подгружаются, когда Claude читает файлы в них. Бывает ещё памятка организации (managed policy) — её раскладывают администраторы.',
    level: 2,
  },
  {
    id: 'file-claude-local-md',
    category: 'files',
    title: 'CLAUDE.local.md',
    syntax: './CLAUDE.local.md',
    summary: 'Твоя личная памятка об одном проекте: команде она не видна.',
    details: 'Добавь её в .gitignore, чтобы она не уехала в репозиторий.',
    level: 2,
  },
  {
    id: 'concept-auto-memory',
    category: 'concepts',
    title: 'Автопамять',
    syntax: 'запомни, что …',
    summary: 'Claude сам ведёт заметки о проекте; «запомни…» попадает сюда, а не в CLAUDE.md.',
    details:
      'Заметки лежат в ~/.claude/projects/<проект>/memory/MEMORY.md; в каждую сессию грузятся первые 200 строк (до 25 КБ). В интерфейсе видно Saved 2 memories и Recalled 2 memories.\n\nАвтопамять включена по умолчанию, выключается в /memory.',
    level: 2,
  },
  {
    id: 'slash-memory',
    category: 'slash',
    title: '/memory',
    syntax: '/memory',
    summary: 'Открывает памятки CLAUDE.md для правки, включает и выключает автопамять, показывает её заметки.',
    details: 'Быстрой записи через # больше нет: попроси «добавь в CLAUDE.md…» или поправь файл через /memory.',
    level: 2,
  },

  // ───────────── t4 · sessions ─────────────
  {
    id: 'cli-continue',
    category: 'cli',
    title: 'claude -c',
    syntax: 'claude -c',
    summary: 'Продолжает последний разговор в этой папке. Длинная форма — --continue.',
    details: 'Восстанавливается и контекст, и режим разрешений. Сессии claude -p сюда не попадают.',
    level: 2,
  },
  {
    id: 'cli-resume',
    category: 'cli',
    title: 'claude -r',
    syntax: 'claude -r [имя или ID]',
    summary: 'Без аргумента открывает выбор сессий, с именем или ID — сразу нужную. Длинная форма — --resume.',
    details: 'В выборе сессию можно переименовать: Ctrl+R.',
    level: 2,
  },
  {
    id: 'slash-resume',
    category: 'slash',
    title: '/resume',
    syntax: '/resume [сессия]',
    summary: 'То же, что claude -r, но изнутри сессии: открывает выбор или нужный разговор.',
    details: 'Фоновые сессии в списке помечены bg.',
    level: 2,
  },
  {
    id: 'slash-rename',
    category: 'slash',
    title: '/rename',
    syntax: '/rename [имя]',
    summary: 'Даёт сессии имя: оно видно в строке ввода, в /resume и в заголовке терминала.',
    details: 'Имя можно дать и при запуске: claude -n <имя>.',
    level: 2,
  },

  // ───────────── chips ─────────────
  {
    id: 'key-ctrl-r',
    category: 'keys',
    title: 'Ctrl+R',
    syntax: 'Ctrl+R',
    summary: 'Поиск по истории твоих запросов.',
    level: 2,
  },
  {
    id: 'slash-btw',
    category: 'slash',
    title: '/btw',
    syntax: '/btw <вопрос>',
    summary: 'Вопрос в сторону: Claude ответит, но вопрос не добавится в разговор.',
    level: 2,
  },
  {
    id: 'concept-claude-md-imports',
    category: 'concepts',
    title: 'Импорт в CLAUDE.md',
    syntax: '@path/to/file',
    summary: 'Строка с @путём внутри CLAUDE.md подключает другой файл, вложенность — до четырёх шагов.',
    details: 'Путь считается от самой памятки. Правила для отдельных путей кладут в .claude/rules/*.md с полем paths: в шапке.',
    level: 2,
  },
  {
    id: 'file-agents-md',
    category: 'files',
    title: 'AGENTS.md',
    syntax: 'AGENTS.md',
    summary: 'Если CLAUDE.md нет, Claude читает AGENTS.md.',
    details: 'В сессии тогда появится строка no CLAUDE.md found; AGENTS.md loaded: <путь>.',
    level: 2,
  },
];
