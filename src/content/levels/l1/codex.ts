// Codex entries first taught in level 1 (terminals and chips). Facts: docs/claude-code-reference.md §1.
import type { CodexEntry } from '../../types';

export const codex: CodexEntry[] = [
  // ───────────── t1 · first launch ─────────────
  {
    id: 'cli-claude',
    category: 'cli',
    title: 'claude',
    syntax: 'claude',
    summary: 'Запускает Claude Code в текущей папке: сессия работает с файлами этой папки.',
    details:
      'Сначала перейди в папку проекта (cd ~/city/alley-lights), потом набери claude. В заголовке сессии видны версия, модель и рабочая папка.\n\nПри самом первом запуске Claude попросит войти в аккаунт. /login меняет аккаунт, /logout выходит из него.',
    level: 1,
  },
  {
    id: 'concept-plain-language',
    category: 'concepts',
    title: 'Просьбы обычными словами',
    syntax: 'что делает этот проект?',
    summary: 'С Claude говорят как с человеком: спрашивают и просят словами, на любом языке.',
    details:
      'Файлы показывать не нужно — Claude сам находит и читает их. Хороший порядок работы: сначала спросить «почему», потом попросить исправить.\n\nСессия стартует в auto mode: Claude сам правит и запускает команды, а фоновый классификатор проверяет его действия.',
    level: 1,
  },

  // ───────────── t2 · /init and CLAUDE.md ─────────────
  {
    id: 'slash-init',
    category: 'slash',
    title: '/init',
    syntax: '/init',
    summary: 'Claude изучает проект и пишет памятку CLAUDE.md: команды сборки и тестов, устройство кода.',
    details: 'Если CLAUDE.md уже есть, /init не перезапишет его, а предложит улучшения. После /init допиши то, чего Claude не узнает из кода.',
    level: 1,
  },
  {
    id: 'file-claude-md',
    category: 'files',
    title: 'CLAUDE.md',
    syntax: './CLAUDE.md',
    summary: 'Памятка проекта: Claude читает её в начале каждой сессии.',
    details:
      'Пиши туда то, что важно всегда: команды сборки и тестов, правила, подвохи. Держи файл коротким — примерно до 200 строк.\n\nCLAUDE.md в корне проекта кладут в git, и памятка достаётся всей команде.',
    level: 1,
  },
  {
    id: 'concept-claude-md-rules',
    category: 'concepts',
    title: 'Правило в памятку',
    syntax: 'добавь в CLAUDE.md правило: …',
    summary: 'Чтобы Claude помнил правило и в следующих сессиях, попроси записать его в CLAUDE.md.',
    details:
      'Просьба в чате живёт, пока идёт разговор. Правило в CLAUDE.md переживает любую сессию.\n\nБыстрой записи через # больше нет: просто попроси словами.',
    level: 1,
  },

  // ───────────── t3 · permission dialog ─────────────
  {
    id: 'concept-permission-dialog',
    category: 'concepts',
    title: 'Диалог разрешений',
    syntax: 'Do you want to proceed?',
    summary: 'Claude показывает команду и спрашивает: Yes — один раз, «don\'t ask again» — правило на будущее, No — отказ.',
    details:
      'Yes, and don\'t ask again for: npm test * сохраняет правило в .claude/settings.local.json — только для этого репозитория. Давай его безопасным частым командам.\n\nВ ручном режиме (⏸ manual mode on) спрашивают правки и большинство команд, а чтение файлов идёт без вопросов. Так сессию запускают командой claude --permission-mode manual.\n\nОбычная сессия стартует в auto mode, и диалогов почти нет. Иногда в диалоге есть и вариант Yes, and switch to auto mode.',
    level: 1,
  },
  {
    id: 'key-esc-no',
    category: 'keys',
    title: 'Esc в диалоге разрешений',
    syntax: 'Esc',
    summary: 'В диалоге разрешений Esc значит No: команда не запустится, а Claude спросит, как быть.',
    details: 'После отказа скажи словами, что сделать вместо этого. Tab на Yes или No позволяет добавить к ответу комментарий.',
    level: 1,
  },
  {
    id: 'slash-exit',
    category: 'slash',
    title: '/exit',
    syntax: '/exit',
    summary: 'Закрывает Claude Code и возвращает в оболочку. Другое имя — /quit.',
    level: 1,
  },

  // ───────────── t4 · bonus ─────────────
  {
    id: 'concept-specific-prompts',
    category: 'concepts',
    title: 'Точная просьба',
    syntax: 'что сломано · где · как это выглядит',
    summary: 'Чем точнее просьба, тем меньше догадок: назови место и симптом.',
    details: '«Почини баг» хуже, чем «почини вход: после неверного пароля экран остаётся пустым». Точная просьба экономит круги переспросов.',
    level: 1,
  },
  {
    id: 'cli-claude-prompt',
    category: 'cli',
    title: 'claude "задача"',
    syntax: 'claude "<задача>"',
    summary: 'Открывает обычную сессию и сразу отправляет ей первую просьбу.',
    details: 'Задачу берут в кавычки, иначе оболочка разрежет её на слова. Не путай с claude -p "…": тот ответит один раз и выйдет.',
    level: 1,
  },
  {
    id: 'slash-help',
    category: 'slash',
    title: '/help',
    syntax: '/help',
    summary: 'Показывает справку: доступные команды и подсказки.',
    level: 1,
  },
  {
    id: 'key-shortcuts',
    category: 'keys',
    title: '? — горячие клавиши',
    syntax: '?',
    summary: '? на пустой строке ввода открывает и закрывает панель горячих клавиш.',
    level: 1,
  },
  {
    id: 'key-newline',
    category: 'keys',
    title: 'Новая строка',
    syntax: '\\ + Enter',
    summary: 'Обратный слэш и Enter переносят строку, не отправляя просьбу. Работает в любом терминале.',
    details: 'Ещё способы: Ctrl+J в любом терминале; Shift+Enter — в Windows Terminal, iTerm2, WezTerm, Ghostty, Kitty, Warp и Apple Terminal. В других терминалах его добавляет /terminal-setup.',
    level: 1,
  },

  // ───────────── chips ─────────────
  {
    id: 'cli-version',
    category: 'cli',
    title: 'claude --version',
    syntax: 'claude --version',
    summary: 'Печатает версию Claude Code, например 2.1.281 (Claude Code).',
    details: 'Если оболочка отвечает «not found», папка установки не прописана в PATH.',
    level: 1,
  },
  {
    id: 'concept-slash-menu',
    category: 'concepts',
    title: 'Меню команд',
    syntax: '/',
    summary: 'Набери / — откроется меню всех команд и скиллов; печатай дальше, чтобы сузить список, Tab допишет.',
    level: 1,
  },
  {
    id: 'concept-message-queue',
    category: 'concepts',
    title: 'Очередь сообщений',
    summary: 'Сообщение, отправленное, пока Claude работает, встаёт в очередь, а не прерывает его.',
    details: 'Сообщения, за которые Claude ещё не взялся, видны серым. Чтобы именно прервать работу, нажми Esc.',
    level: 1,
  },
  {
    id: 'key-ctrl-c',
    category: 'keys',
    title: 'Ctrl+C и Ctrl+D',
    syntax: 'Ctrl+C · Ctrl+D',
    summary: 'Ctrl+C прерывает работу; когда Claude ничего не делает, первое нажатие очищает ввод, второе закрывает Claude Code.',
    details: 'Ctrl+D: первое нажатие покажет подсказку, второе в течение 800 мс закроет сессию. Если в строке есть текст, Ctrl+D удаляет символ под курсором.',
    level: 1,
  },
];
