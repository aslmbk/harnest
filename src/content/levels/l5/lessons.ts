// Level 5 — «Башня Ядра»: automation and scale (subagents, headless, worktrees, the final exam; bonus: GitHub).
// Facts: docs/claude-code-reference.md §5 (and §1–§3 for the exam). Tool rows and screen layouts are flavour
// (UNVERIFIED there); strings the player must type or recognise are verified.
import type { LevelLessons, LevelMeta, TermLine } from '../../types';

const tool = (text: string): TermLine => ({ text, style: 'tool' });
const result = (text: string): TermLine => ({ text, style: 'result' });
const say = (text: string): TermLine => ({ text, style: 'claude' });
const code = (text: string): TermLine => ({ text, style: 'code' });
const dim = (text: string): TermLine => ({ text, style: 'dim' });
const add = (text: string): TermLine => ({ text, style: 'diffAdd' });
const del = (text: string): TermLine => ({ text, style: 'diffDel' });
const box = (text: string): TermLine => ({ text, style: 'box' });
const ok = (text: string): TermLine => ({ text, style: 'ok' });

// Answer pattern parts (anchored, case-insensitive, see match.ts).
/** A prompt in words: not a slash command, not shell mode, not the removed # shortcut. */
const WORDS = '(?![/!#])';
const P = '(?:-p|--print)';
const QT = `["'][^"']+["']`; // a quoted prompt
const PQ = `(?:${P} ${QT}|${QT} ${P})`; // -p and the prompt, in either order
const PUMP_LOG = '(?:\\./)?logs/pump\\.log';
const TAKE_LOG = `(?:cat|(?:tail|head)(?: -n ?\\d+| -\\d+)?) ${PUMP_LOG}`;
/** A bare mention of the subagent, with no task. */
const VENT_MENTION = '(?:@agent-vent-inspector|@"vent-inspector \\(agent\\)")[\\s.,:;!?…]*';
const CORE_MENTION = '(?:@agent-core-checker|@"core-checker \\(agent\\)"|core-checker)[\\s.,:;!?…]*';
const PUMP_RULE = `["'](?:[^"']*,\\s*)?Bash\\(npm run pump-check(?: \\*|:\\*)?\\)(?:\\s*,[^"']*)?["']`;

export const meta: LevelMeta = {
  title: 'Башня Ядра',
  subtitle: 'Автоматизация и масштаб: субагенты, headless, параллельная работа',
  topics: [
    'Субагенты: .claude/agents/, @agent-имя',
    'Headless: claude -p, пайпы, --output-format json, --allowedTools',
    'Параллельная работа: claude --worktree, Ctrl+B, /tasks',
    'Экзамен: перезапуск Ядра',
    'Бонус: Claude в GitHub',
  ],
  intro: [
    'Башня Ядра стоит в самом центре купола. Отсюда город получал свет, воздух и воду — пока Ядро не замолчало. Сторож Крон держит башню на резервах, но резервы кончаются.',
    'Один оператор всего не успеет. Здесь ты научишься звать помощников, оставлять Claude работать без оператора и вести несколько дел одновременно.',
    'Цель: оживить вентиляцию, насосную станцию и трамвай — и перезапустить Ядро.',
  ],
  outro: [
    'Ядро гудит ровно. Купол светится, по кольцу снова идёт трамвай, и квартал за кварталом в окнах загорается свет. Нижний город просыпается.',
    'Ты прошёл весь путь: от первого claude до бригад помощников, ночных смен и параллельных путей. ХАРНИ больше не просто ремонтный робот — теперь он оператор города. А Claude Code — его надёжный напарник.',
  ],
};

export const lessons: LevelLessons = {
  terminals: [
    // ───────────── t1 · Subagents ─────────────
    {
      id: 't1',
      title: 'Вентиляция купола',
      required: true,
      challenge: {
        title: 'Бригада помощников',
        brief:
          'Вентиляция купола встаёт каждую ночь в 03:00. Ответ где-то в трёх тысячах журналов — столько не влезет ни в один контекст.',
        cwd: '~/city/dome-vents',
        unlocks: ['concept-subagent', 'file-claude-agents', 'concept-agent-mention'],
        steps: [
          {
            id: 's1',
            kind: 'command',
            prompt: 'claude',
            task: 'Этот терминал не выключали: в сессии до сих пор висит разговор Крона про лифт башни. Начни свою задачу с чистого контекста.',
            accept: ['/clear(?: .+)?'],
            example: '/clear',
            hints: ['Это одна слэш-команда из Рынка Памяти.', 'Она «очищает» разговор — по-английски.'],
            wrong: [
              { match: '/compact.*', reply: '/compact сожмёт разговор, но лифт останется в памяти. Нужна чистая страница.' },
              { match: '/exit|/quit', reply: 'Выходить не нужно: чистый лист даёт одна команда прямо в сессии.' },
              { match: '/(?:rewind|undo|checkpoint).*', reply: 'Перемотка вернёт разговор к старой точке, но не очистит его.' },
              { match: '/resume.*', reply: 'Это откроет старый разговор. А нужен новый, пустой.' },
            ],
            output: [dim('Контекст пуст. Разговор про лифт остался в /resume.')],
            explain: 'Новая задача — новый контекст. Чужие детали в контексте только сбивают Claude с толку.',
          },
          {
            id: 's2',
            kind: 'choice',
            style: 'quiz',
            task: 'Журналов три тысячи. Как их разобрать, не забив контекст сессии?',
            question: 'Как разобрать журналы?',
            options: [
              {
                label: 'Поручить субагенту: он читает в своём контексте и приносит сводку',
                correct: true,
                reply: 'Твой контекст останется чистым — в нём окажется только вывод.',
              },
              {
                label: 'Упомянуть всю папку @logs и читать здесь',
                reply: '@ с папкой даёт только список файлов. А читать их всё равно пришлось бы здесь, в твоём контексте.',
              },
              { label: 'Читать по одному и делать /clear после каждого', reply: 'Тогда Claude будет забывать то, что уже нашёл.' },
            ],
            hints: ['Тяжёлое чтение лучше отдать кому-то другому.', 'Помощник со своим собственным контекстом — это субагент.'],
            explain: 'Большие расследования отдают субагенту: он прочтёт хоть всё, а в основной разговор вернёт одну сводку.',
          },
          {
            id: 's3',
            kind: 'command',
            prompt: 'claude',
            task: 'Попроси Claude создать проектного субагента vent-inspector в .claude/agents/: он только читает журналы (Read, Grep, Glob) и ищет причину сбоев.',
            accept: [`${WORDS}(?=.*vent-inspector)(?=.*(?:agent|агент|помощник)).{12,}`],
            example: 'создай субагента vent-inspector в .claude/agents/: только Read, Grep, Glob, ищет причины сбоев в журналах',
            hints: [
              'Мастера для субагентов больше нет — просто попроси Claude словами.',
              'Назови имя, папку и инструменты: vent-inspector, .claude/agents/, Read, Grep, Glob.',
              'Например: «создай субагента vent-inspector в .claude/agents/: только Read, Grep, Glob».',
            ],
            wrong: [
              {
                match: '/agents.*',
                reply: 'Мастера /agents больше нет — команда теперь только печатает напоминание. Попроси Claude словами или напиши файл сам.',
              },
              {
                match: '(?=.*vent-inspector)(?=.*(?:skill|скилл)).*',
                reply: 'Скилл — рецепт для этой же сессии. Тут нужен помощник со своим контекстом — субагент.',
              },
              { match: '(?!.*vent-inspector)(?=.*(?:agent|агент|помощник)).*', reply: 'Дай помощнику имя vent-inspector — по нему его будут звать.' },
            ],
            output: [
              tool('Write(.claude/agents/vent-inspector.md)'),
              result('Wrote 8 lines'),
              code('---'),
              code('name: vent-inspector'),
              code('description: Reads dome vent logs and finds causes of failures'),
              code('tools: Read, Grep, Glob'),
              code('model: haiku'),
              code('---'),
              code('You read vent logs. Report the root cause and the files involved.'),
              code('Never edit anything.'),
            ],
            explain:
              'Субагент — это файл: в шапке обязательны name и description, тело — его системный промпт. tools ограничивает руки: этот помощник только читает.',
          },
          {
            id: 's4',
            kind: 'command',
            prompt: 'claude',
            task: 'Позови vent-inspector упоминанием и поручи найти, почему вентиляция встаёт в 03:00.',
            accept: [
              `${WORDS}(?!${VENT_MENTION}$)(?=.*@agent-vent-inspector).{20,}`,
              `${WORDS}(?!${VENT_MENTION}$)(?=.*@"vent-inspector \\(agent\\)").{20,}`,
              `${WORDS}(?!${VENT_MENTION}$)(?=.*vent-inspector)(?=.*(?:agent|агент)).{20,}`,
            ],
            example: '@agent-vent-inspector найди, почему вентиляция встаёт в 03:00',
            hints: [
              'Субагента упоминают через @, как файл, только с приставкой.',
              'Приставка — agent-, потом имя: @agent-…',
              'Например: «@agent-vent-inspector найди, почему вентиляция встаёт в 03:00».',
            ],
            wrong: [
              { match: '(?=.*@vent-inspector)(?!.*agent).*', reply: 'Почти: у субагентов в упоминании есть приставка agent-. Набери @agent- и имя.' },
              {
                match: '/(?:agents|vent-inspector).*',
                reply: 'Слэш не нужен: мастера /agents больше нет, а /имя — это скиллы. Позови помощника упоминанием: @agent- и имя.',
              },
              { match: VENT_MENTION, reply: 'Помощник позван, а задачи нет. Допиши, что найти: почему вентиляция встаёт в 03:00.' },
              {
                match: '(?!.*vent-inspector).*(?:журнал|лог|log|03:00).*',
                reply: 'Так Claude станет читать всё сам, в твоём контексте. Поручи журналы vent-inspector — позови его через @.',
              },
            ],
            output: [
              tool('vent-inspector(Find why the dome vents stop at 03:00)'),
              result('Done (41 tool uses · 58k tokens · 1m 12s)'),
              say('Сводка от vent-inspector: в 03:00 запускается ночная продувка'),
              say('night-purge.sh. Она закрывает заслонки, а вентиляторы ещё тянут'),
              say('воздух — и встают от перегрузки. Порядок задан в src/schedule.ts.'),
            ],
            explain: '58 тысяч токенов журналов остались в контексте субагента. Тебе пришли три строки — и место для работы.',
          },
          {
            id: 's5',
            kind: 'choice',
            style: 'quiz',
            task: 'Завтра Крон просто напишет Claude: «разберись с журналами вентиляции» — без имени помощника. Кто, скорее всего, возьмётся за журналы?',
            question: 'Кто возьмётся за журналы?',
            options: [
              { label: 'vent-inspector: задача подходит под его описание', correct: true, reply: 'Да. По description Claude сам понимает, кому отдать работу.' },
              { label: 'Никто: субагента зовут только по имени', reply: 'Нет: Claude зовёт субагента и сам, если задача подходит под description.' },
              {
                label: 'Claude прочтёт всё сам, в основном контексте',
                reply: 'Может, но у него есть помощник с подходящим описанием — разумнее отдать работу ему.',
              },
            ],
            hints: ['Вспомни, зачем в шапке субагента поле description.', 'По описанию Claude решает, кого позвать.'],
            explain: 'Хорошее description — половина субагента: по нему Claude решает, когда звать помощника. Пиши в нём, что он делает и когда нужен.',
          },
          {
            id: 's6',
            kind: 'command',
            prompt: 'claude',
            task: 'Попроси Claude исправить расписание в src/schedule.ts по сводке: вентиляторы должны останавливаться раньше заслонок.',
            accept: [`${WORDS}(?!.*@agent-)(?=.*(?:schedule|расписани|исправ|почин|fix|заслон|вентилятор)).{8,}`],
            example: 'исправь расписание в src/schedule.ts: сначала вентиляторы, потом заслонки',
            hints: ['Сводка уже в разговоре — просто попроси исправить.', 'Например: «исправь расписание в src/schedule.ts: сначала вентиляторы, потом заслонки».'],
            wrong: [
              {
                match: '(?=.*@agent-).*',
                reply: 'Инспектор только читает — инструментов для правки у него нет. Исправит основная сессия: просто попроси Claude.',
              },
              { match: '/clear(?: .*)?', reply: 'Стоп: /clear сотрёт сводку инспектора, а она нужна для правки.' },
            ],
            output: [
              tool('Edit(src/schedule.ts)'),
              del('at("03:00", closeDampers);'),
              del('at("03:00", stopFans);'),
              add('at("02:58", stopFans);'),
              add('at("03:00", closeDampers);'),
              tool('Bash(npm test)'),
              result('18 passed'),
              say('Вентиляторы теперь замирают за две минуты до заслонок.'),
              dim('Над куполом снова тянет прохладой.'),
            ],
            explain: 'Субагент нашёл, основная сессия починила — с чистым контекстом и проверкой тестами.',
          },
        ],
      },
    },

    // ───────────── t2 · Headless ─────────────
    {
      id: 't2',
      title: 'Насосная станция',
      required: true,
      requires: ['t1'],
      challenge: {
        title: 'Ночная смена',
        brief:
          'Давление в насосной станции падает по ночам, когда у пульта никого нет. Крон хочет, чтобы Claude проверял насос сам, по расписанию, — без оператора.',
        cwd: '~/city/pump',
        unlocks: ['cli-print', 'concept-pipe', 'cli-output-format', 'cli-allowed-tools'],
        steps: [
          {
            id: 's1',
            kind: 'command',
            prompt: 'shell',
            task: 'Спроси Claude одной командой, не открывая сессию: что делает скрипт night-check.sh? Ответ должен напечататься, а команда — завершиться.',
            accept: [`(?=.*(?:night-check|ночн|скрипт|script|насос|pump))claude ${P} ${QT}`, `(?=.*(?:night-check|ночн|скрипт|script|насос|pump))claude ${QT} ${P}`],
            example: 'claude -p "что делает night-check.sh?"',
            hints: ['Для «спросить и выйти» у claude есть флаг печати.', 'Флаг -p, а вопрос — в кавычках.', 'Шаблон: claude -p "<вопрос>"'],
            wrong: [
              { match: `claude ${QT}`, reply: 'Так откроется обычная сессия с этим запросом. Чтобы ответить и сразу выйти, нужен флаг -p.' },
              { match: `claude ${P} [^"'].*`, reply: 'Возьми вопрос в кавычки — иначе оболочка разрежет его на отдельные слова.' },
              { match: 'claude (?:-c|--continue).*', reply: '-c продолжает прошлый разговор. А тут нужен один ответ без сессии.' },
              { match: 'claude', reply: 'Так откроется интерактивная сессия. Нужен ответ одной командой — с флагом -p и вопросом в кавычках.' },
            ],
            output: ['night-check.sh — ночная проверка насоса P2: раз в 10 минут меряет', 'давление и пишет отчёт в reports/night.txt.'],
            explain: '-p — это «вопрос, ответ, выход». Так Claude встраивают в скрипты: ему не нужен ни экран, ни оператор.',
          },
          {
            id: 's2',
            kind: 'command',
            prompt: 'shell',
            task: 'Отдай Claude журнал logs/pump.log через пайп и попроси объяснить, почему ночью падает давление.',
            accept: [
              `${TAKE_LOG} ?\\| ?claude ${PQ}(?: ?> ?\\S+)?`,
              `claude ${PQ} < ?${PUMP_LOG}(?: > ?\\S+)?`,
              `< ?${PUMP_LOG} claude ${PQ}(?: > ?\\S+)?`,
            ],
            example: 'cat logs/pump.log | claude -p "почему ночью падает давление?"',
            hints: [
              'Пайп «|» передаёт вывод одной команды на вход другой.',
              'Файл выводит cat, а дальше — claude -p с вопросом.',
              'Шаблон: cat <файл> | claude -p "<вопрос>"',
            ],
            wrong: [
              {
                match: `claude ${P} ["'][^"']*pump\\.log[^"']*["']`,
                reply: 'Сработает и так — Claude сам прочтёт файл. Но потренируй пайп: отдай журнал через «|».',
              },
              { match: `(?:cat|tail|head)[^|]*\\| ?claude ${QT}.*`, reply: 'Без -p Claude откроет сессию. В пайпе нужен ответ-и-выход: добавь -p.' },
              { match: `cat ${PUMP_LOG} > .*`, reply: '«>» пишет в файл. Передать вывод другой команде — это «|».' },
              { match: `cat ${PUMP_LOG}`, reply: 'Журнал напечатан, но Claude его не видел. Передай вывод дальше через «|».' },
            ],
            output: ['Давление падает в 02:57: клапан V3 закрывается раньше, чем насос P2', 'выходит на режим. Нужна задержка закрытия около 30 секунд.'],
            explain: 'Пайп отдаёт Claude что угодно: журнал, вывод тестов, diff. Так строят цепочки: команда | claude -p "…" > отчёт.txt.',
          },
          {
            id: 's3',
            kind: 'command',
            prompt: 'shell',
            task: 'Табло башни читает только JSON. Задай вопрос про журнал ещё раз так, чтобы ответ пришёл в JSON — с полем result и id сессии.',
            accept: [`(?:(?:cat|tail|head)[^|]*\\| ?)?claude (?=(?:.* )?${P}(?: |$))(?=.*--output-format[ =]json(?: |$))(?=.*${QT}).+`],
            example: 'cat logs/pump.log | claude -p "почему ночью падает давление?" --output-format json',
            hints: ['Формат ответа задаёт отдельный флаг.', 'Флаг --output-format, значение json.', 'Шаблон: … | claude -p "<вопрос>" --output-format json'],
            wrong: [
              { match: '.*--output-format[ =]stream-json.*', reply: 'stream-json — поток строк для живого наблюдения. Табло нужен один JSON целиком.' },
              { match: '.*--output-format[ =]text.*', reply: 'text — обычный текст, он и так по умолчанию. Нужен json.' },
              { match: '.*--json(?:[ =].*)?', reply: 'Флаг называется длиннее: --output-format, а значение у него — json.' },
              { match: `(?!.*--output-format).*claude ${P} .*`, reply: 'Ответ снова придёт обычным текстом. Добавь флаг формата вывода со значением json.' },
            ],
            output: [
              code('{'),
              code('  "result": "Клапан V3 закрывается раньше, чем насос P2 выходит…",'),
              code('  "session_id": "b7e2c9d4-1f0a-4c3e-9d2b-6a8f0e1c5d73",'),
              code('  "total_cost_usd": 0.0141'),
              code('}'),
              dim('(полей в ответе больше — здесь главные)'),
            ],
            explain:
              'JSON легко разобрать скриптом: result — ответ, session_id — чтобы продолжить разговор через --resume. Достать ответ: … | jq -r \'.result\'.',
          },
          {
            id: 's4',
            kind: 'choice',
            style: 'quiz',
            task: 'Задержку клапана Крон поставил сам. Теперь ночью Claude должен запускать проверку npm run pump-check. Но в -p окна разрешений нет, а у пульта никого. Как быть?',
            question: 'Как дать ночной смене запустить проверку?',
            options: [
              {
                label: 'Заранее разрешить ровно эту команду через --allowedTools',
                correct: true,
                reply: 'Узкое правило: можно ровно то, что нужно ночной смене.',
              },
              { label: 'Запустить с --dangerously-skip-permissions', reply: 'Этот флаг — только для песочниц без интернета. Насос — живая система.' },
              { label: 'Ничего: Claude спросит утром', reply: 'В -p спрашивать некого: без разрешения команда просто не выполнится.' },
            ],
            hints: ['Разрешения можно выдать заранее — флагом при запуске.', 'Флагу передают правило вида Bash(команда) — и разрешено ровно оно.'],
            explain:
              'Для автоматики разрешают ровно нужное: --allowedTools понимает те же правила, что и настройки, например Bash(npm run *). Режим dontAsk запрещает всё, что не разрешено заранее.',
          },
          {
            id: 's5',
            kind: 'command',
            prompt: 'shell',
            task: 'Запусти ночную проверку: попроси Claude проверить насос и заранее разреши ему только одну команду — npm run pump-check.',
            accept: [`claude (?=(?:.* )?${P}(?: |$))(?=.*--allowed-?tools[ =]${PUMP_RULE})(?=(?:[^"']*["'][^"']*["']){2}).+`],
            example: 'claude -p "проверь насос" --allowedTools "Bash(npm run pump-check)"',
            hints: [
              'Разрешения в -p выдают флагом при запуске.',
              'Флаг --allowedTools, правило — Bash(…) в кавычках.',
              'Шаблон: claude -p "<просьба>" --allowedTools "Bash(<команда>)"',
            ],
            wrong: [
              { match: '.*--dangerously-skip-permissions.*', reply: 'Этот флаг — только для песочниц без интернета. Разреши ровно одну команду через --allowedTools.' },
              {
                match: `.*--allowed-?tools[ =]["']?Bash(?:\\(npm run \\*\\))?["']?(?: .*)?`,
                reply: 'Слишком широко: так разрешено больше, чем нужно ночной смене. Сузь правило до Bash(npm run pump-check).',
              },
              { match: '.*--allowed-?tools[ =]Bash\\(.*', reply: 'Возьми правило в кавычки: без них скобки сломают команду в оболочке.' },
              { match: `(?!.*--allowed-?tools)claude ${P} .*`, reply: 'Ночью разрешить будет некому. Добавь флаг, который заранее разрешает команду.' },
            ],
            output: ['npm run pump-check: давление 4.1 бар, клапан V3 закрывается вовремя.', 'Насос в норме.', dim('03:00. Насосная станция работает сама — без оператора.')],
            explain:
              'Ночная смена готова: такой вызов ставят в расписание или CI. Узкие разрешения — и Claude не сделает лишнего, даже когда никто не смотрит.',
          },
        ],
      },
    },

    // ───────────── t3 · Parallel work ─────────────
    {
      id: 't3',
      title: 'Трамвайное кольцо',
      required: true,
      requires: ['t2'],
      challenge: {
        title: 'Параллельные пути',
        brief: 'Трамвай стоит: двери заедают, а расписание сбилось. Чинить нужно и то и другое — одновременно и так, чтобы ремонты не мешали друг другу.',
        cwd: '~/city/tram',
        unlocks: ['cli-worktree', 'key-ctrl-b', 'slash-tasks'],
        steps: [
          {
            id: 's1',
            kind: 'command',
            prompt: 'shell',
            task: 'Запусти Claude в отдельной рабочей копии кода (worktree) с именем tram-doors — для ремонта дверей.',
            accept: [`claude (?:${QT} )?(?:--worktree|-w)[ =]["']?tram-doors["']?(?: ${QT})?`],
            example: 'claude --worktree tram-doors',
            hints: ['У claude есть флаг, который сам создаёт рабочую копию.', 'Флаг --worktree, потом имя.', 'Шаблон: claude --worktree <имя>'],
            wrong: [
              { match: 'git worktree add.*', reply: 'Можно и руками, но Claude сделает всё сам: один флаг создаст копию, ветку и сразу откроет сессию.' },
              { match: 'claude (?:--worktree|-w)', reply: 'Без имени Claude придумает своё, вроде bright-running-fox. Дай понятное: tram-doors.' },
              { match: `claude ["']?tram-doors["']?`, reply: 'Так «tram-doors» уйдёт Claude как запрос. Перед именем нужен флаг рабочей копии.' },
              { match: `claude (?:--worktree|-w)[ =](?!["']?tram-doors).+`, reply: 'Назови копию tram-doors — так потом легко найти и её, и ветку.' },
            ],
            output: [dim('Создана .claude/worktrees/tram-doors/ на ветке worktree-tram-doors.')],
            explain: 'Worktree — отдельная копия репозитория на своей ветке. Сессия в ней ни с кем не толкается: у каждой копии свои файлы.',
          },
          {
            id: 's2',
            kind: 'choice',
            style: 'quiz',
            task: 'Двери чинятся здесь. Как параллельно починить расписание?',
            question: 'Как вести второй ремонт одновременно?',
            options: [
              { label: 'Во втором терминале: claude --worktree tram-schedule', correct: true, reply: 'Две копии, две ветки, две сессии — никто никому не мешает.' },
              { label: 'Здесь же, когда закончу с дверями', reply: 'Можно, но это по очереди, а не параллельно.' },
              { label: 'Второй claude в той же папке, без worktree', reply: 'Две сессии будут править одни и те же файлы и мешать друг другу.' },
            ],
            hints: ['Каждой задаче — своя копия кода.', 'Тот же флаг, другое имя, другой терминал.'],
            explain: 'Параллельные сессии — это параллельные worktree. Потом их ветки сливают, как любые ветки git.',
          },
          {
            id: 's3',
            kind: 'command',
            prompt: 'claude',
            task: 'Попроси Claude починить заедающие двери и прогнать полный набор тестов дверей.',
            accept: [`${WORDS}(?=.*(?:двер|door)).{10,}`],
            example: 'почини заедающие двери и прогони тесты дверей',
            hints: ['Обычная просьба словами.', 'Например: «почини заедающие двери и прогони тесты дверей».'],
            wrong: [
              { match: '(?=.*(?:расписан|schedule))(?!.*(?:двер|door)).*', reply: 'Расписанием займётся вторая сессия. Здесь — двери.' },
              { match: '(?!.*(?:двер|door)).*(?:тест|test).*', reply: 'Сначала — двери: попроси их починить, а потом прогнать тесты.' },
            ],
            output: [
              tool('Read(src/doors.ts)'),
              result('Read 64 lines'),
              tool('Edit(src/doors.ts)'),
              del('const CLOSE_DELAY_MS = 0;'),
              add('const CLOSE_DELAY_MS = 800;'),
              say('Задержки не было — двери хлопали и заедали. Запускаю тесты дверей.'),
              tool('Bash(npm run test:doors)'),
              result('Running 480 scenarios… (≈ 10 min)'),
            ],
            explain: 'Долгие команды не обязательно ждать — сейчас увидишь как.',
          },
          {
            id: 's4',
            kind: 'key',
            task: 'Тесты будут идти минут десять. Не жди: отправь команду в фон, чтобы сессия освободилась.',
            keys: ['Ctrl+B'],
            example: 'Ctrl+B',
            hints: ['Для фона есть сочетание с Ctrl.', 'B — от background.'],
            output: [say('Тесты дверей работают в фоне. Можно заниматься другим.')],
            explain: 'Ctrl+B отправляет в фон идущую команду или субагента: сессия свободна, а работа продолжается.',
          },
          {
            id: 's5',
            kind: 'command',
            prompt: 'claude',
            task: 'Посмотри, что сейчас работает в фоне.',
            accept: ['/tasks', '/bashes'],
            example: '/tasks',
            hints: ['Список фоновой работы открывает слэш-команда.', 'Она называется «задачи» — по-английски.'],
            wrong: [
              { match: '/agents.*', reply: 'Это про субагентов, и мастера там больше нет. Фоновая работа — в другой команде.' },
              { match: '/(?:background|bg)', reply: 'Это отправит в фон весь разговор. А нужен список фоновых задач.' },
              { match: '/status.*', reply: 'Это сведения о сессии. Фоновые задачи — отдельной командой.' },
            ],
            output: [box('npm run test:doors · running · 3m 12s'), dim('Отсюда же фоновую задачу можно остановить.')],
            explain: '/tasks — пульт фоновой работы: видно, что идёт, и можно остановить лишнее.',
          },
          {
            id: 's6',
            kind: 'info',
            task: 'Фоновые тесты закончились. Посмотри, чем всё кончилось.',
            output: [
              dim('Фоновая команда npm run test:doors завершилась:'),
              code('480 passed · 0 failed'),
              say('Все 480 сценариев прошли: двери закрываются мягко.'),
              say('Ветка worktree-tram-doors готова к слиянию.'),
              dim('Во втором терминале готов и ремонт расписания. Трамвай звенит.'),
            ],
            explain: 'Две задачи шли одновременно и не мешали друг другу: каждая — в своей worktree, долгие тесты — в фоне.',
          },
        ],
      },
    },

    // ───────────── t4 · Final exam ─────────────
    {
      id: 't4',
      title: 'Пульт Ядра',
      required: true,
      requires: ['t1', 't2', 't3'],
      challenge: {
        title: 'Перезапуск Ядра',
        brief: 'Ядро молчит, и город держится на резервах. Это последний ремонт: всё, чему ты научился, — в одной сессии.',
        cwd: '~/city/core',
        unlocks: ['concept-operator-session'],
        steps: [
          {
            id: 's1',
            kind: 'command',
            prompt: 'shell',
            task: 'Ты у пульта Ядра, в папке его кода. Запусти Claude Code.',
            accept: ['claude'],
            example: 'claude',
            hints: ['С этого начинался каждый твой ремонт.', 'Одно слово — имя помощника.'],
            wrong: [
              { match: `claude ${P}.*`, reply: '-p ответит и выйдет. Для большого ремонта нужна живая сессия.' },
              { match: 'claude --dangerously-skip-permissions.*', reply: 'Только не с Ядром! Обычная сессия — и контроль у тебя.' },
              { match: 'claude --permission-mode[ =]plan', reply: 'Хороший ход! Но здесь начни с обычной сессии — в режим планирования перейдёшь клавишами.' },
              { match: 'claude (?:-c|--continue|-r|--resume).*', reply: 'Старый разговор тут не поможет. Начни новую сессию.' },
            ],
            explain: 'Каждый большой ремонт начинается одинаково: сессия в папке проекта.',
          },
          {
            id: 's2',
            kind: 'key',
            task: 'Ядро — главная система города. Сначала пусть Claude изучит и спланирует, ничего не меняя.',
            keys: ['Shift+Tab'],
            untilMode: 'plan',
            example: 'Shift+Tab',
            hints: ['Нужен режим, где Claude только читает и планирует.', 'Shift+Tab по кругу, пока не появится ⏸ plan mode on.'],
            explain: 'Сложная задача — сначала план. В plan mode Claude читает код, но ничего не правит, пока ты не одобришь.',
          },
          {
            id: 's3',
            kind: 'command',
            prompt: 'claude',
            task: 'Спроси, почему Ядро не стартует, и сразу покажи Claude файл загрузки src/boot.ts — упоминанием.',
            accept: ['(?=.*@(?:\\./)?src/boot\\.ts).{14,}'],
            example: 'почему Ядро не стартует? @src/boot.ts',
            hints: ['Файл в запрос добавляет упоминание.', 'Упоминание начинается с @.', 'Например: «почему Ядро не стартует? @src/boot.ts».'],
            wrong: [
              { match: '(?!.*@)(?=.*src/boot\\.ts).*', reply: 'Почти: поставь @ перед путём — тогда файл сразу попадёт в контекст.' },
              { match: '(?!.*boot).+', reply: 'Покажи Claude файл загрузки: упомяни src/boot.ts через @.' },
            ],
            output: [
              tool('Grep("power|cooling", src/)'),
              result('Found 6 files'),
              say('В src/boot.ts охлаждение стартует раньше питания — и Ядро глохнет.'),
              box('План: перезапуск Ядра'),
              box('1. src/boot.ts: включать питание раньше охлаждения'),
              box('2. Проверка: субагент core-checker прогоняет все модули'),
              box('3. Коммит — после него Ядро перезапустится само'),
            ],
            explain: 'Упоминание сразу кладёт файл в контекст, а plan mode даёт план до первой правки. Так большие ремонты не идут вслепую.',
          },
          {
            id: 's4',
            kind: 'choice',
            style: 'quiz',
            task: 'План хороший, правка одна. Пусть Claude правит сам — свой контроль ты оставишь на коммит.',
            question: 'Claude закончил план. Что ответишь?',
            options: [
              { label: 'Yes, and use auto mode', correct: true, reply: 'План одобрен. Claude правит src/boot.ts.' },
              {
                label: 'Yes, manually approve edits',
                reply: 'Так тоже можно, но сегодня ты доверил Claude эту одну правку. Контроль будет на коммите.',
              },
              { label: 'No, keep planning', reply: 'План уже ясный. Пора действовать.' },
            ],
            hints: ['Ты хочешь, чтобы Claude правил без лишних вопросов.', 'Нужен вариант с auto mode.'],
            setMode: 'auto',
            output: [
              tool('Edit(src/boot.ts)'),
              del('await cooling.start();'),
              del('await power.start();'),
              add('await power.start();'),
              add('await cooling.start();'),
              dim('хук PostToolUse: core-lint — ok'),
              say('Порядок исправлен: сначала питание, потом охлаждение.'),
            ],
            explain: 'Одобрение плана выбирает и режим дальше: в auto Claude действует сам под присмотром классификатора, в manual каждую правку одобряешь ты.',
          },
          {
            id: 's5',
            kind: 'command',
            prompt: 'claude',
            task: 'Поручи проверку субагенту core-checker — его давно завели старые операторы. Пусть прогонит все модули Ядра.',
            accept: [`${WORDS}(?!${CORE_MENTION}$)(?!.*@core-checker)(?=.*core-checker).{12,}`],
            example: '@agent-core-checker проверь все модули Ядра',
            hints: ['Субагента зовут упоминанием или по имени.', 'Упоминание: @agent- и имя.', 'Например: «@agent-core-checker проверь все модули Ядра».'],
            wrong: [
              {
                match: '/(?:agents|core-checker).*',
                reply: 'Слэш не нужен: мастера /agents больше нет, а /имя — это скиллы. Позови помощника: @agent- и имя.',
              },
              { match: '.*@core-checker.*', reply: 'Почти: у субагентов в упоминании есть приставка agent-.' },
              { match: CORE_MENTION, reply: 'Помощник позван, а задачи нет. Допиши: пусть прогонит все модули Ядра.' },
              { match: '! ?npm (?:run )?test.*', reply: 'Тоже проверка! Но модулей двенадцать — пусть их прогонит core-checker в своём контексте.' },
            ],
            output: [
              tool('core-checker(Check all Core modules after the boot fix)'),
              result('Done (24 tool uses · 31k tokens · 52s)'),
              say('core-checker: 12 из 12 модулей стартуют, npm test — 64 passed.'),
            ],
            explain: 'Проверку тоже можно поручить: субагент прогонит всё в своём контексте и вернёт итог. Без проверки ремонт не закончен.',
          },
          {
            id: 's6',
            kind: 'key',
            task: 'Остался коммит в главную ветку Ядра. Такие шаги ты одобряешь сам — переключись в ручной режим.',
            keys: ['Shift+Tab'],
            untilMode: 'manual',
            example: 'Shift+Tab',
            hints: ['Нужен режим, где Claude спрашивает перед каждой командой.', 'Shift+Tab, пока не появится ⏸ manual mode on.'],
            explain: 'Режим можно менять посреди работы: рутину доверить Claude, а к важному шагу вернуть контроль.',
          },
          {
            id: 's7',
            kind: 'command',
            prompt: 'claude',
            task: 'Попроси Claude закоммитить исправление.',
            accept: [`${WORDS}(?=.*(?:комм?ит|commit)).{6,}`],
            example: 'закоммить исправление',
            hints: ['Коммит можно просто попросить словами.', 'Например: «закоммить исправление».'],
            wrong: [
              { match: '! ?git commit.*', reply: 'Можно и самому, но попроси Claude: он посмотрит diff и сам напишет сообщение.' },
              { match: '/commit-commands:commit.*', reply: 'Набор сработал бы, но здесь попроси Claude словами: он сам посмотрит diff и напишет сообщение.' },
              { match: '/commit.*', reply: 'Такой команды тут нет — просто попроси Claude словами.' },
            ],
            explain: 'Коммит словами — обычная практика: Claude смотрит diff и пишет понятное сообщение.',
          },
          {
            id: 's8',
            kind: 'choice',
            style: 'permission',
            task: 'Claude просит разрешение на коммит. Это главная ветка Ядра: этот коммит пусть идёт, но каждый следующий ты тоже хочешь видеть.',
            context: [say('Закоммичу исправление загрузки.')],
            permission: {
              tool: 'Bash command',
              description: 'Commit the boot order fix',
              command: 'git commit -am "fix(core): power up before cooling"',
              note: 'This command requires approval',
            },
            question: 'Do you want to proceed?',
            options: [
              { label: 'Yes', correct: true, reply: 'Коммит создан.' },
              {
                label: "Yes, and don't ask again for: git commit *",
                reply: 'Тогда все будущие коммиты Ядра пойдут без вопросов. Для главной системы города — слишком щедро.',
              },
              {
                label: 'Yes, and switch to auto mode · auto mode handles these prompts for you',
                reply: 'Ты только что сам включил ручной режим — как раз ради этого шага.',
              },
              { label: 'No', esc: true, reply: 'Тогда исправление не попадёт в историю, а Ядро не перезапустится.' },
            ],
            hints: ['Нужно «да» для этого коммита, но не для всех будущих.', 'Разовое «да» — первый вариант.'],
            output: [
              tool('Bash(git commit -am "fix(core): power up before cooling")'),
              result('[main 9f3c2a1] fix(core): power up before cooling'),
              result('1 file changed, 2 insertions(+), 2 deletions(-)'),
              dim('core-watch: новый коммит. Перезапуск Ядра…'),
              code('power ........ ok'),
              code('cooling ...... ok'),
              code('grid ......... ok'),
              ok('ЯДРО ЗАПУЩЕНО'),
              dim('Квартал за кварталом загораются окна. Купол светится.'),
            ],
            explain: 'Разовое «да» — для важных необратимых шагов. Рутину отдаёшь Claude, а главное держишь в своих руках.',
          },
        ],
      },
    },

    // ───────────── t5 · bonus: GitHub ─────────────
    {
      id: 't5',
      title: 'Почтовый терминал',
      required: false,
      challenge: {
        title: 'Claude на почте',
        brief: 'На почту башни сыплются заявки — issues. Пул Реквестович не успевает их разбирать. Пусть Claude отвечает на них прямо в GitHub.',
        cwd: '~/city/tower-mail',
        unlocks: ['slash-install-github-app', 'concept-claude-in-github'],
        steps: [
          {
            id: 's1',
            kind: 'command',
            prompt: 'claude',
            task: 'Подключи Claude к GitHub-репозиторию почты. Одна команда из сессии поставит приложение, сохранит ключ и подготовит workflow.',
            accept: ['/install-github-app'],
            example: '/install-github-app',
            hints: ['Это слэш-команда установки.', 'Она ставит GitHub-приложение: install-…-app.', 'Шаблон: /install-<сервис>-app'],
            wrong: [
              { match: '/github.*', reply: 'Почти: команда ставит приложение — /install-…-app.' },
              { match: '/install(?:-github)?', reply: 'Почти: в полном имени есть и github, и app.' },
              { match: '/plugin install.*', reply: 'Плагины — другое. Для GitHub есть своя команда установки приложения.' },
            ],
            output: [
              dim('Приложение Claude установлено в репозиторий city/tower-mail.'),
              dim('Секрет ANTHROPIC_API_KEY сохранён в настройках репозитория.'),
              dim('Открыт PR с workflow. Главный шаг в нём:'),
              code('- uses: anthropics/claude-code-action@v1'),
            ],
            explain: 'Работает с репозиториями на github.com. Команда делает три вещи: ставит приложение, сохраняет секрет и открывает PR с workflow.',
          },
          {
            id: 's2',
            kind: 'choice',
            style: 'quiz',
            task: 'Пул Реквестович волнуется: где теперь лежит ключ, с которым бот работает в GitHub?',
            question: 'Где хранится ключ?',
            options: [
              { label: 'В секретах репозитория: ANTHROPIC_API_KEY', correct: true, reply: 'Секрет не виден в коде, а workflow получает его при запуске.' },
              { label: 'Прямо в файле workflow', reply: 'Ключ в коде прочтёт любой, у кого есть доступ к репозиторию. Для этого и придуманы секреты.' },
              { label: 'В CLAUDE.md, чтобы бот его нашёл', reply: 'CLAUDE.md — памятка, её коммитят. Ключам там не место.' },
            ],
            hints: ['Ключи не кладут в файлы репозитория.', 'У GitHub есть хранилище для таких значений — secrets.'],
            explain: 'Ключи живут в секретах, а не в коде. Иногда вместо ANTHROPIC_API_KEY сохраняется CLAUDE_CODE_OAUTH_TOKEN.',
          },
          {
            id: 's3',
            kind: 'choice',
            style: 'quiz',
            task: 'PR с workflow открыт. Что нужно, чтобы бот начал отвечать?',
            question: 'Что дальше?',
            options: [
              { label: 'Слить этот PR в основную ветку', correct: true, reply: 'После слияния workflow заработает на каждом @claude.' },
              { label: 'Ничего — бот уже работает', reply: 'Пока PR не слит, workflow нет в основной ветке — и бот молчит.' },
              { label: 'Перезапустить claude', reply: 'Локальная сессия тут ни при чём: бот живёт в GitHub Actions.' },
            ],
            hints: ['Workflow пока лежит в PR, а не в основной ветке.', 'PR нужно принять — слить.'],
            output: [dim('PR слит. Бот на дежурстве.')],
            explain: 'Бот — это GitHub Actions: он работает из workflow в репозитории и отвечает в issue и PR.',
          },
          {
            id: 's4',
            kind: 'command',
            prompt: 'claude',
            task: 'Пул Реквестович принёс issue №12 «Сортировать письма по башням». Попроси Claude оставить в нём комментарий, который позовёт бота и попросит сделать эту фичу.',
            accept: ['(?=.*@claude(?![\\w-]))(?=.*(?:12|issue|ишью|комментар|comment)).{12,}'],
            example: 'оставь в issue 12 комментарий: @claude implement this feature based on the issue description',
            hints: [
              'Бот откликается на своё имя через @.',
              'В комментарии должно быть @claude и просьба.',
              'Например: «оставь в issue 12 комментарий: @claude implement this feature based on the issue description».',
            ],
            wrong: [
              { match: '(?!.*@claude).*(?:issue|ишью|12|комментар|comment).*', reply: 'Бот откликается на своё имя: в комментарии должно быть @claude.' },
              { match: '/install-github-app', reply: 'Приложение уже стоит. Теперь позови бота в issue.' },
              { match: '(?=.*@claude)(?!.*(?:12|issue|ишью|комментар|comment)).*', reply: 'Куда писать? В issue №12 — комментарием.' },
            ],
            output: [
              tool('Bash(gh issue comment 12 --body "@claude implement this feature…")'),
              result('https://github.com/city/tower-mail/issues/12#issuecomment-1'),
              dim('Через минуту в issue отвечает бот и берётся за работу.'),
              dim('Вскоре приходит PR #13 «Сортировка писем по башням».'),
            ],
            explain: '@claude в issue или PR — как позвать коллегу: бот читает обсуждение, делает работу и приносит PR.',
          },
          {
            id: 's5',
            kind: 'choice',
            style: 'quiz',
            task: 'Бот открыл PR #13 с сортировкой писем. Что с ним делать?',
            question: 'Что дальше с PR #13?',
            options: [
              { label: 'Прочитать и проверить, как работу коллеги', correct: true, reply: 'Да: бот делает работу, а отвечаешь за результат ты.' },
              { label: 'Сразу слить — бот не ошибается', reply: 'Ошибается, как любой коллега. Если не можешь проверить — не выпускай.' },
              { label: 'Закрыть: код от бота брать нельзя', reply: 'Можно и нужно — после проверки. Для этого бота и звали.' },
            ],
            hints: ['Кто бы ни написал код, его проверяют.', 'PR от бота — как PR от коллеги.'],
            output: [dim('PR проверен и слит. Письма сами разлетаются по башням.')],
            explain: 'Бот в GitHub ускоряет работу, но не снимает ответственность: PR читают, проверяют тестами и только потом сливают.',
          },
        ],
      },
    },
  ],

  npcs: [
    {
      id: 'kron',
      name: 'Крон',
      model: 'npc_tall',
      tint: '#bff4ff',
      dialogs: [
        {
          when: { gateOpen: true },
          lines: [
            { text: 'Ядро гудит ровно. Слышишь? Сорок лет такого не слышал.', mood: 'happy' },
            { text: 'Город светится до самого купола. Ночную смену теперь держит Claude — по расписанию, как положено.', mood: 'happy' },
            { text: 'Ты больше не ремонтник, ХАРНИ. Ты оператор.', mood: 'neutral' },
            { text: 'Бип-бип!', speaker: 'ХАРНИ', mood: 'excited' },
          ],
        },
        {
          when: { done: ['t3'], notDone: ['t4'] },
          lines: [
            { text: 'Вентиляция, насос, трамвай. Все пути свободны. Остался пульт Ядра.', mood: 'neutral' },
            { text: 'Нового там ничего. План, контекст, помощники, проверка — и твоё «да» на важном шаге.', mood: 'thinking' },
            { text: 'Не спеши. Ядро не любит суеты.', mood: 'neutral' },
          ],
        },
        {
          when: { done: ['t2'], notDone: ['t3'] },
          lines: [
            { text: 'Насос работает ночью сам. Хорошо.', mood: 'happy' },
            { text: 'Теперь трамвай. Там две беды сразу: двери и расписание. По очереди — до утра провозишься.', mood: 'worried' },
            { text: 'Нужны параллельные пути. Worktree: у каждой сессии своя копия кода и своя ветка. Не толкаются.', mood: 'neutral' },
            { text: 'А долгие тесты — в фон. Пусть идут, пока ты занят другим.', mood: 'neutral' },
          ],
        },
        {
          when: { done: ['t1'], notDone: ['t2'] },
          lines: [
            { text: 'Бригада справилась. Вентиляция дышит.', mood: 'happy' },
            { text: 'Теперь ночная смена. Ночью у пультов никого. Claude должен работать сам: вопрос — ответ — выход.', mood: 'neutral' },
            { text: 'Это headless-режим. Без окна и без оператора. Такой Claude встраивают в скрипты и расписания.', mood: 'neutral' },
            { text: 'Только не давай ему всё подряд. Ночью спросить разрешения некого — разреши заранее ровно то, что нужно.', mood: 'thinking' },
          ],
        },
        {
          when: { notDone: ['t1'] },
          lines: [
            { text: 'Крон. Сторож башни. Слежу, чтобы всё шло по расписанию. Даже когда все спят.', mood: 'neutral' },
            { text: 'Один оператор всего не прочтёт. Журналов тут — на сто лет. Я зову бригаду.', mood: 'thinking' },
            { text: 'Субагент — помощник со своей головой. Читает тонну, а тебе приносит одну страницу. Твой контекст остаётся чистым.', mood: 'neutral' },
            { text: 'Начни с вентиляции купола. Каждую ночь в 03:00 она встаёт.', mood: 'worried' },
            { text: 'Бип? 03:00 — это не ваше расписание?', speaker: 'ХАРНИ', mood: 'thinking' },
            { text: '…Проверим.', mood: 'thinking' },
          ],
        },
        {
          lines: [
            { text: 'Бригада — для тяжёлого чтения.', mood: 'neutral' },
            { text: 'Ночная смена — для повторяющегося.', mood: 'neutral' },
            { text: 'Параллельные пути — для одновременного. Остальное — по расписанию.', mood: 'neutral' },
          ],
        },
      ],
    },
    {
      id: 'pul',
      name: 'Пул Реквестович',
      model: 'npc_drone',
      tint: '#ff5a4f',
      dialogs: [
        {
          when: { done: ['t5'] },
          lines: [
            { text: 'Письма разобраны! Бот отвечает прямо в почте и сам приносит PR.', mood: 'excited' },
            { text: 'Я их, конечно, читаю перед слиянием. Доверяй, но проверяй — так у нас на почте говорят.', mood: 'happy' },
            { text: 'Держи марку. С Ядром! Редкая.', mood: 'happy' },
          ],
        },
        {
          lines: [
            { text: 'Пул Реквестович, почтовый дрон. Письма, заявки, просьбы — горы! И каждая называется issue.', mood: 'worried' },
            { text: 'Говорят, Claude можно поселить прямо в почте. Пишешь в заявке @claude — и он берётся за дело.', mood: 'thinking' },
            { text: 'Почтовый терминал у меня за спиной. Подключишь? Я тебе марку подарю. С Ядром!', mood: 'excited' },
          ],
        },
      ],
    },
  ],

  chips: [
    {
      id: 'c1',
      title: 'Встроенные субагенты',
      text: 'Своих субагентов писать не обязательно: есть встроенные Explore (поиск по коду, только чтение), Plan и general-purpose. Claude зовёт их сам.',
      unlocks: ['concept-builtin-subagents'],
    },
    {
      id: 'c2',
      title: 'Лимит ходов',
      text: 'В -p можно ограничить число ходов: claude -p "…" --max-turns 3. Флаг описан в документации, но скрыт из --help.',
      unlocks: ['cli-max-turns'],
    },
    {
      id: 'c3',
      title: 'Сессия в фоне',
      text: 'claude --bg "задача" запускает целую сессию в фоне, а claude agents показывает, кто работает, а кто ждёт ответа. Пока это research preview.',
      unlocks: ['cli-bg'],
    },
    {
      id: 'c4',
      title: 'Что брать в worktree',
      text: 'Новая worktree — чистая копия: зависимости ставь заново, а .env и похожие файлы перенесёт список .worktreeinclude.',
      unlocks: ['file-worktreeinclude'],
    },
  ],

  zones: [
    { id: 'z1', text: 'Башня Ядра. Сначала — к Крону: он тут главный по ночам.' },
    { id: 'z2', text: 'Пульт Ядра. Последний ремонт будет здесь.', when: { notDone: ['t4'] } },
    { id: 'z3', text: 'Почтовый терминал. Письма копятся тут с прошлого века…', when: { notDone: ['t5'] } },
  ],
};
