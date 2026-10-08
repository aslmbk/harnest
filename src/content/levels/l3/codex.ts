// Codex entries first taught in level 3 (terminals and chips). Facts: docs/claude-code-reference.md §3.
import type { CodexEntry } from '../../types';

export const codex: CodexEntry[] = [
  // ───────────── t1 · permission modes ─────────────
  {
    id: 'concept-permission-modes',
    category: 'concepts',
    title: 'Режимы разрешений',
    syntax: 'auto · manual · accept edits · plan',
    summary: 'Режим решает, что Claude делает сам, а о чём спрашивает. Текущий режим виден в строке под вводом.',
    details:
      '⏵⏵ auto mode on — всё сам, действия проверяет классификатор. ⏸ manual mode on — без спроса только чтение. ⏵⏵ accept edits on — без спроса правки файлов и простые команды вроде mkdir, mv, cp. ⏸ plan mode on — только чтение и план.\n\nЕсть ещё dontAsk (всё, что не разрешено заранее, запрещено) и bypassPermissions (всё без вопросов, только для изолированных машин). В настройках ручной режим называется default.',
    level: 3,
  },
  {
    id: 'key-shift-tab',
    category: 'keys',
    title: 'Shift+Tab',
    syntax: 'Shift+Tab',
    summary: 'Переключает режим по кругу: auto → manual → accept edits → plan → auto.',
    details: 'Режим меняется только в текущей сессии. В диалоге правки файла Shift+Tab выбирает разрешение на всю сессию.',
    level: 3,
  },
  {
    id: 'concept-auto-mode',
    category: 'concepts',
    title: 'Auto mode',
    syntax: '⏵⏵ auto mode on',
    summary: 'Режим, в котором стартует обычная сессия: Claude действует сам, а отдельный классификатор проверяет его действия.',
    details:
      'Правила ask всё равно спрашивают. Нужна поддерживающая модель (не Haiku), администратор может режим отключить. Документация предупреждает: безопасность он не гарантирует.',
    level: 3,
  },
  {
    id: 'cli-permission-mode',
    category: 'cli',
    title: '--permission-mode',
    syntax: 'claude --permission-mode <режим>',
    summary: 'Запускает сессию сразу в нужном режиме: manual, acceptEdits, plan, auto, dontAsk или bypassPermissions.',
    details:
      'Флаг главнее настройки "permissions": {"defaultMode": "…"}, а та — главнее встроенного auto. Значение "auto" в .claude/settings.json и .claude/settings.local.json игнорируется: его ставят в ~/.claude/settings.json.',
    level: 3,
  },

  // ───────────── t2 · plan mode ─────────────
  {
    id: 'concept-plan-mode',
    category: 'concepts',
    title: 'Режим планирования',
    syntax: '⏸ plan mode on',
    summary: 'Claude изучает код и предлагает план, но ничего не правит, пока ты его не одобришь.',
    details:
      'Включить: Shift+Tab до ⏸ plan mode on, команда /plan с задачей или запуск claude --permission-mode plan. Ещё один Shift+Tab выводит из режима без одобрения.',
    level: 3,
  },
  {
    id: 'slash-plan',
    category: 'slash',
    title: '/plan',
    syntax: '/plan <задача>',
    summary: 'Включает режим планирования и сразу даёт Claude задачу.',
    level: 3,
  },
  {
    id: 'concept-plan-approval',
    category: 'concepts',
    title: 'Одобрение плана',
    syntax: 'Yes, and use auto mode · Yes, manually approve edits · No, keep planning',
    summary: 'Ответ на готовый план: работать без вопросов, одобрять каждую правку или планировать дальше.',
    details:
      'Если auto mode недоступен, первый вариант называется Yes, auto-accept edits. Ctrl+G открывает план в текстовом редакторе — его можно поправить руками.',
    level: 3,
  },
  {
    id: 'concept-explore-plan-implement-commit',
    category: 'concepts',
    title: 'Изучи → спланируй → сделай → закоммить',
    syntax: 'Explore → Plan → Implement → Commit',
    summary: 'Рекомендуемый порядок большой работы: сначала разобраться и спланировать, потом делать и сохранять.',
    details: 'Для мелочей план не нужен — хватит прямой просьбы. А хороший план кончается проверкой, которую Claude запустит сам.',
    level: 3,
  },

  // ───────────── t3 · Esc and rewind ─────────────
  {
    id: 'key-esc',
    category: 'keys',
    title: 'Esc — стоп',
    syntax: 'Esc',
    summary: 'Останавливает ответ Claude или команду на полуслове; сделанное до этого остаётся.',
    details: 'Сообщения из очереди пойдут следом. В диалоге Esc закрывает его, а в диалоге разрешений значит No.',
    level: 3,
  },
  {
    id: 'key-esc-esc',
    category: 'keys',
    title: 'Esc Esc',
    syntax: 'Esc Esc',
    summary: 'На пустой строке открывает меню перемотки; если в строке текст — стирает его.',
    details: 'Стёртый текст вернёт стрелка вверх.',
    level: 3,
  },
  {
    id: 'slash-rewind',
    category: 'slash',
    title: '/rewind',
    syntax: '/rewind',
    summary: 'Открывает меню перемотки к одному из прошлых запросов. Другие имена — /checkpoint и /undo.',
    details:
      'Пункты меню: Restore code and conversation, Restore conversation, Restore code, Summarize from here, Summarize up to here, Never mind. Пункты с кодом появляются, только когда Claude правил файлы.',
    level: 3,
  },
  {
    id: 'concept-checkpoints',
    category: 'concepts',
    title: 'Точки перемотки и их пределы',
    summary: 'Каждый запрос — точка перемотки, но правки от команд Bash, внешние правки и правки субагентов она не вернёт.',
    details: 'Точки переживают возобновление сессии. Документация прямо пишет: это не замена системе контроля версий — важное коммить в git.',
    level: 3,
  },

  // ───────────── t4 · permission rules ─────────────
  {
    id: 'slash-permissions',
    category: 'slash',
    title: '/permissions',
    syntax: '/permissions',
    summary: 'Показывает правила разрешений по файлам настроек, добавляет и удаляет allow, ask и deny.',
    details: 'Там же — рабочие папки и действия, которые отклонил auto mode.',
    level: 3,
  },
  {
    id: 'concept-permission-rules',
    category: 'concepts',
    title: 'Правила allow, ask, deny',
    syntax: '{"permissions": {"allow": [], "ask": [], "deny": []}}',
    summary: 'Правила заранее разрешают, требуют спросить или запрещают инструменты и команды.',
    details:
      'Примеры: Bash(npm run *) — команды, начинающиеся с npm run; Read(./.env) — чтение .env; WebFetch(domain:example.com) — загрузки с домена. Пробел перед * важен: Bash(git diff*) поймает и git diff-index.\n\nФайлы: ~/.claude/settings.json (твои), .claude/settings.json (команда), .claude/settings.local.json (твои в проекте). Списки складываются.',
    level: 3,
  },
  {
    id: 'concept-rule-order',
    category: 'concepts',
    title: 'Порядок правил',
    syntax: 'deny → ask → allow',
    summary: 'Сначала проверяются запреты, потом «спросить», потом разрешения; решает первое совпадение.',
    details: 'Deny-правила действуют в любом режиме, даже в bypassPermissions.',
    level: 3,
  },
  {
    id: 'cli-dangerously-skip-permissions',
    category: 'cli',
    title: '--dangerously-skip-permissions',
    syntax: 'claude --dangerously-skip-permissions',
    summary: 'Запуск в режиме bypassPermissions: всё без вопросов. По справке — только для песочниц без интернета.',
    details:
      'Allow-правила там ничего не значат, а deny и ask продолжают работать; удаления вроде rm -rf ~ всё равно не пройдут сами. Безопаснее — auto mode или узкие allow-правила.\n\n--allow-dangerously-skip-permissions лишь добавляет bypass в круг Shift+Tab.',
    level: 3,
  },

  // ───────────── t5 · model, effort, verification ─────────────
  {
    id: 'slash-model',
    category: 'slash',
    title: '/model',
    syntax: '/model [модель]',
    summary: 'Выбор модели; выбор сохраняется для новых сессий, а клавиша s меняет модель только сейчас.',
    details:
      'Псевдонимы: default, best, fable, opus, sonnet, haiku, opusplan и другие. best — Fable, если доступна, иначе Opus; opusplan — Opus для плана, Sonnet для работы. При запуске — флаг --model, на ходу — Alt+P (Option+P на Mac).',
    level: 3,
  },
  {
    id: 'slash-effort',
    category: 'slash',
    title: '/effort',
    syntax: '/effort low|medium|high|xhigh|max|auto',
    summary: 'Задаёт глубину рассуждений для сессии; у Opus 5.5 и Sonnet 5.5 по умолчанию medium.',
    details: 'При запуске — флаг --effort. Уровень можно менять и стрелками в списке /model.',
    level: 3,
  },
  {
    id: 'concept-ultrathink',
    category: 'concepts',
    title: 'ultrathink',
    syntax: 'ultrathink',
    summary: 'Слово в просьбе: один ход глубокого рассуждения, без смены усилия для всей сессии.',
    details: '«think hard» и «think harder» теперь обычные слова — особой силы у них нет.',
    level: 3,
  },
  {
    id: 'concept-verify-check',
    category: 'concepts',
    title: 'Проверка для Claude',
    syntax: '… и прогони тесты после правки',
    summary: 'Дай Claude проверку, которую он запустит сам: тесты, сборку, скриншот. Иначе проверкой становишься ты.',
    details: 'Это совет №1 из лучших практик. И правило: если не можешь проверить — не выпускай.',
    level: 3,
  },

  // ───────────── chips ─────────────
  {
    id: 'key-ctrl-g',
    category: 'keys',
    title: 'Ctrl+G',
    syntax: 'Ctrl+G',
    summary: 'Открывает запрос или план Claude в текстовом редакторе.',
    level: 3,
  },
  {
    id: 'key-ctrl-o',
    category: 'keys',
    title: 'Ctrl+O',
    syntax: 'Ctrl+O',
    summary: 'Открывает подробный журнал разговора со всеми свёрнутыми строками.',
    level: 3,
  },
  {
    id: 'slash-diff',
    category: 'slash',
    title: '/diff',
    syntax: '/diff',
    summary: 'Показывает все изменения в рабочей копии: красным и зелёным, с номерами строк.',
    level: 3,
  },
  {
    id: 'slash-code-review',
    category: 'slash',
    title: '/code-review',
    syntax: '/code-review',
    summary: 'Ревью твоих изменений. Другое имя — /review.',
    details: 'Для проверки безопасности есть /security-review, а /verify собирает, запускает и наблюдает приложение.',
    level: 3,
  },
];
