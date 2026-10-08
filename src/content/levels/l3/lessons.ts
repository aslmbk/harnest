// Level 3 — «Депо Планов»: control (permission modes and Shift+Tab, plan mode, Esc and rewind;
// bonus: /permissions and rules, /model, /effort, ultrathink, a check Claude can run).
// Facts: docs/claude-code-reference.md §3. Tool rows and screen layouts are flavour (UNVERIFIED there);
// strings the player must type or recognise are verified.
import type { LevelLessons, LevelMeta, TermLine } from '../../types';

const tool = (text: string): TermLine => ({ text, style: 'tool' });
const result = (text: string): TermLine => ({ text, style: 'result' });
const say = (text: string): TermLine => ({ text, style: 'claude' });
const code = (text: string): TermLine => ({ text, style: 'code' });
const dim = (text: string): TermLine => ({ text, style: 'dim' });
const add = (text: string): TermLine => ({ text, style: 'diffAdd' });
const del = (text: string): TermLine => ({ text, style: 'diffDel' });
const box = (text: string): TermLine => ({ text, style: 'box' });

// Answer pattern parts (anchored, case-insensitive, see match.ts).
/** A prompt in words: not a slash command, not shell mode, not the removed # shortcut. */
const WORDS = '(?![/!#])';
const YES = '(?:да|ага|ок|окей|yes|ok|okay|давай|угу)[.!]*';
const FIX = '(?:исправ|почин|поправ|измен|поменя|сдела|fix|change|repair)';
const CRANE = '(?:кран|контейнер|груз|захват|урон|роня|crane|container|cargo|load|grip|drop|почему|why)';
const THINK_HARD = '(?=.*think(?:ing)? (?:hard|harder|deeply|more|a lot)).*';

export const meta: LevelMeta = {
  title: 'Депо Планов',
  subtitle: 'Контроль: режимы, план, стоп-кран',
  topics: [
    'Режимы разрешений и Shift+Tab, строка статуса',
    'Режим планирования: /plan и одобрение плана',
    'Esc — стоп, Esc Esc и /rewind — перемотка',
    'Бонус: /permissions и правила, /model, /effort, ultrathink',
  ],
  intro: [
    'Депо Планов шипит паром. Здесь стоят краны, стрелки и поворотный круг — тяжёлые машины, которые не прощают спешки. Бригадир Лямбда держит депо по трём правилам: думай до, тормози вовремя, у каждого рычага — замок.',
    'Claude умеет много сам. Здесь ты научишься решать, сколько ему можно: выбирать режим, требовать план до первой правки, останавливать его на полуслове и откатывать неудачные шаги.',
    'Цель: перевести стрелки, починить портальный кран и оживить поворотный круг.',
  ],
  outro: [
    'Депо гудит ровно. Ты переключал режимы, планировал до правок, останавливал Claude, когда он шёл не туда, и перематывал неудачную попытку.',
    'Правила Лямбды теперь твои: думай до, тормози вовремя, держи рычаги на замке. Впереди Квартал Инструментов — там Claude учат новым трюкам.',
  ],
};

export const lessons: LevelLessons = {
  terminals: [
    // ───────────── t1 · permission modes and Shift+Tab ─────────────
    {
      id: 't1',
      title: 'Стрелочный пост',
      required: true,
      challenge: {
        title: 'Режимы и рычаги',
        brief:
          'Стрелка 4 переводится, пока состав ещё на ней. Сменщик оставил терминал поста включённым, и Семафор жалуется: Claude только рассуждает.',
        cwd: '~/city/rail-switch',
        startMode: 'plan',
        unlocks: ['concept-permission-modes', 'key-shift-tab', 'concept-auto-mode', 'cli-permission-mode'],
        steps: [
          {
            id: 's1',
            kind: 'command',
            prompt: 'claude',
            task: 'Попроси Claude починить стрелку 4: она переводится, пока состав ещё на ней.',
            accept: [`${WORDS}(?=.*(?:стрел|switch|задерж|delay|${FIX})).{8,}`],
            example: 'почини стрелку 4: она переводится раньше времени',
            hints: ['Обычная просьба словами.', 'Например: «почини стрелку 4: она переводится раньше времени».'],
            wrong: [
              { match: `${YES}`, reply: 'Скажи, что сделать: починить стрелку 4.' },
              { match: '/(?!exit$|quit$).*', reply: 'Команда не нужна — попроси Claude словами.' },
            ],
            output: [
              tool('Read(config/switches.json)'),
              result('Read 30 lines'),
              tool('Read(src/switch.ts)'),
              result('Read 75 lines'),
              box('План: стрелка 4'),
              box('1. config/switches.json: задержка стрелки 4 — 2500 мс вместо 0'),
              box('2. Проверить, что состав успевает сойти'),
            ],
            explain: 'Claude изучил код и предложил план — но ни одного файла не тронул. Сейчас разберёмся почему.',
          },
          {
            id: 's2',
            kind: 'choice',
            style: 'quiz',
            task: 'Claude только предложил план и ничего не правит. Почему? Ответ — в строке под вводом.',
            context: [dim('Строка под вводом:'), code('⏸ plan mode on (shift+tab to cycle)')],
            question: 'Что показывает строка статуса?',
            options: [
              { label: 'Включён режим планирования: Claude только читает', correct: true, reply: 'Да: ⏸ plan mode on. Правки ждут одобренного плана.' },
              { label: 'Claude сломался', reply: 'Он в порядке. Загляни в строку под вводом: там написан режим.' },
              { label: 'У Claude нет доступа к файлам', reply: 'Доступ есть. Просто в этом режиме Claude только читает и планирует.' },
            ],
            hints: ['Под строкой ввода написан текущий режим.', 'Там ⏸ plan mode on.'],
            explain: 'Строка под вводом всегда показывает режим. Привыкай смотреть на неё, прежде чем чего-то ждать от Claude.',
          },
          {
            id: 's3',
            kind: 'key',
            task: 'Стрелки — живой механизм: каждую команду хочется видеть самому. Переключи сессию в ручной режим.',
            keys: ['Shift+Tab'],
            untilMode: 'manual',
            example: 'Shift+Tab',
            hints: ['Режим меняет одно сочетание клавиш — следи за строкой статуса.', 'Shift+Tab по кругу, пока не увидишь ⏸ manual mode on.'],
            explain: 'Shift+Tab ходит по кругу: auto → manual → accept edits → plan → снова auto. Выход из plan mode так — без одобрения плана.',
          },
          {
            id: 's4',
            kind: 'choice',
            style: 'quiz',
            task: 'Семафор просит: «Пусть Claude правит конфиги стрелок сам, а я потом проверю правки». Какой режим подходит?',
            question: 'Какой режим выбрать?',
            options: [
              { label: 'accept edits: правки файлов без вопросов', correct: true, reply: 'Да: Claude правит сам, а ты проверяешь после.' },
              { label: 'plan: Claude только читает и планирует', reply: 'Так Claude не тронет ни одного файла.' },
              { label: 'manual: каждую правку одобряешь сам', reply: 'Семафор не хочет отвечать на каждую правку — он проверит всё разом.' },
            ],
            hints: ['Правки — без вопросов, проверка — потом.', 'Режим так и называется: «принимать правки».'],
            explain: 'accept edits — для работы, которую ты просмотришь после. Другие команды, кроме простых файловых вроде mkdir и mv, в нём по-прежнему спрашивают.',
          },
          {
            id: 's5',
            kind: 'key',
            task: 'Переключи сессию в этот режим.',
            keys: ['Shift+Tab'],
            untilMode: 'acceptEdits',
            example: 'Shift+Tab',
            hints: ['То же сочетание — следи за строкой статуса.', 'Нужно ⏵⏵ accept edits on.'],
            explain: 'Сразу в нужном режиме сессию запускают флагом: claude --permission-mode acceptEdits. Shift+Tab меняет режим уже на ходу.',
          },
          {
            id: 's6',
            kind: 'command',
            prompt: 'claude',
            task: 'Теперь попроси Claude сделать правку по своему плану.',
            accept: [`${WORDS}(?=.*(?:план|plan|дела|правь|правк|приступ|выполн|go|do it|implement|apply|стрел|switch|задерж|delay|${FIX})).{4,}`],
            example: 'делай правку по плану',
            hints: ['Обычная просьба словами — режим уже выбран.', 'Например: «делай правку по плану».'],
            wrong: [
              { match: `${YES}`, reply: 'Скажи чуть больше: «делай правку по плану».' },
              { match: '/(?!exit$|quit$).*', reply: 'Команда не нужна — попроси Claude словами.' },
            ],
            output: [
              tool('Edit(config/switches.json)'),
              del('"4": { "delayMs": 0 },'),
              add('"4": { "delayMs": 2500 },'),
              say('Правка сделана без вопросов — режим accept edits. Проверь её.'),
              dim('Стрелка 4 щёлкает и мягко переводит путь.'),
            ],
            explain: 'В accept edits Claude правит файлы сам, а ты проверяешь результат. Удобно, когда правок много, а риск небольшой.',
          },
          {
            id: 's7',
            kind: 'choice',
            style: 'quiz',
            task: 'Семафор сомневается: «А в auto mode Claude совсем без присмотра?» Что ему ответить?',
            question: 'Что происходит в auto mode?',
            options: [
              { label: 'Действует сам, а классификатор проверяет действия', correct: true, reply: 'Да. Но и он не гарантия: важное держи под контролем.' },
              { label: 'Делает всё подряд без всякой проверки', reply: 'Это режим bypassPermissions — он только для песочниц.' },
              { label: 'Спрашивает разрешения перед каждой командой', reply: 'Так ведёт себя ручной режим. В auto запросов почти нет.' },
            ],
            hints: ['Обычная сессия стартует именно в auto mode.', 'В auto есть отдельный проверяющий — классификатор.'],
            explain: 'Обычная сессия стартует в auto mode: удобно для долгих задач. Правила ask всё равно спрашивают, а документация честно пишет: безопасность не гарантирована.',
          },
        ],
      },
    },

    // ───────────── t2 · plan mode, /plan, approval, Explore → Plan → Implement → Commit ─────────────
    {
      id: 't2',
      title: 'Портальный кран',
      required: true,
      requires: ['t1'],
      challenge: {
        title: 'Сначала план',
        brief: 'Портальный кран роняет контейнеры. Код у него большой и чужой, а ошибка стоит дорого — тут сначала думают, потом делают.',
        cwd: '~/city/depot-crane',
        unlocks: ['concept-plan-mode', 'slash-plan', 'concept-plan-approval', 'concept-explore-plan-implement-commit'],
        steps: [
          {
            id: 's1',
            kind: 'command',
            prompt: 'claude',
            task: 'Включи режим планирования одной командой — и сразу дай задачу: найти, почему кран роняет контейнеры.',
            accept: [`/plan (?=.*${CRANE}).{6,}`],
            example: '/plan найди, почему кран роняет контейнеры',
            hints: ['Есть слэш-команда, которая включает план и сразу берёт задачу.', 'Команда /plan, после неё — задача словами.', 'Например: /plan найди, почему кран роняет контейнеры'],
            wrong: [
              { match: '/plan', reply: 'Допиши задачу после /plan — так Claude сразу возьмётся за план.' },
              { match: `/plan (?!.*${CRANE}).+`, reply: 'Задача про кран: найди, почему он роняет контейнеры.' },
              {
                match: `${WORDS}.{6,}`,
                reply: 'Потренируй команду: /plan и задача. Она сразу включает режим планирования и отдаёт Claude просьбу.',
              },
            ],
            setMode: 'plan',
            output: [
              tool('Read(src/crane.ts)'),
              result('Read 212 lines'),
              tool('Grep("release", src/)'),
              result('Found 4 files'),
              say('Нашёл: захват разжимается по таймеру и не ждёт, пока груз'),
              say('коснётся платформы.'),
              box('План: мягкая посадка груза'),
              box('1. src/grip.ts: разжимать захват только по датчику касания'),
              box('2. Перезапустить кран'),
            ],
            explain: '/plan с задачей — короткий путь в режим планирования. Claude изучает код и предлагает план, но ничего не правит до твоего одобрения.',
          },
          {
            id: 's2',
            kind: 'choice',
            style: 'quiz',
            task: 'В плане нет проверки — а без неё ремонт не закончен. Верни Claude к планированию.',
            question: 'Claude закончил план. Что ответишь?',
            options: [
              { label: 'Yes, and use auto mode', reply: 'Так Claude начнёт править по плану без проверки. Сначала доработай план.' },
              { label: 'Yes, manually approve edits', reply: 'Это тоже одобрение — а план ещё не готов.' },
              { label: 'No, keep planning', correct: true, reply: 'Claude остаётся в режиме планирования и ждёт поправок.' },
            ],
            hints: ['Одобрять ещё рано.', 'Нужен вариант «нет, планируем дальше».'],
            explain: 'План можно возвращать сколько угодно раз: поправить план дешевле, чем исправлять сделанное.',
          },
          {
            id: 's3',
            kind: 'command',
            prompt: 'claude',
            task: 'Скажи, что добавить в план: тест, который проверяет, что груз на весу не отпускается.',
            accept: [`${WORDS}(?=.*(?:тест|test|провер|check)).{8,}`],
            example: 'добавь тест: груз на весу не отпускается',
            hints: ['Просто скажи словами, чего не хватает в плане.', 'Например: «добавь тест: груз на весу не отпускается».'],
            wrong: [
              { match: '/plan(?: .*)?', reply: 'Режим планирования уже включён. Просто скажи, что добавить.' },
              { match: `${YES}`, reply: 'Скажи, чего не хватает: теста на груз на весу.' },
            ],
            output: [
              say('Добавил проверку.'),
              box('План: мягкая посадка груза'),
              box('1. src/grip.ts: разжимать захват только по датчику касания'),
              box('2. tests/grip.test.ts: груз на весу не отпускается'),
              box('3. npm test, потом коммит'),
            ],
            explain: 'Хороший план кончается проверкой: тест, сборка или запуск, которые Claude сможет прогнать сам.',
          },
          {
            id: 's4',
            kind: 'choice',
            style: 'quiz',
            task: 'Теперь план полный. Пусть Claude правит по нему сам, без вопросов на каждую правку.',
            question: 'Claude закончил план. Что ответишь?',
            options: [
              { label: 'Yes, and use auto mode', correct: true, reply: 'План одобрен. Claude правит сам.' },
              { label: 'Yes, manually approve edits', reply: 'Так тоже можно, но тогда каждую правку одобряешь ты. А ты хотел без вопросов.' },
              { label: 'No, keep planning', reply: 'План уже полный. Пора действовать.' },
            ],
            hints: ['Ты хочешь, чтобы Claude правил без вопросов.', 'Нужен вариант с auto mode.'],
            setMode: 'auto',
            output: [
              tool('Edit(src/grip.ts)'),
              del('setTimeout(release, 1200);'),
              add('onTouchdown(release);'),
              tool('Write(tests/grip.test.ts)'),
              result('Wrote 18 lines'),
              tool('Bash(npm test)'),
              result('23 passed'),
              say('Захват разжимается только после касания. Тесты зелёные.'),
            ],
            explain: 'Одобрение выбирает режим для работы: auto mode — правки без вопросов, manually approve edits — каждую одобряешь сам.',
          },
          {
            id: 's5',
            kind: 'choice',
            style: 'quiz',
            task: 'Изучили, спланировали, сделали. Что осталось по порядку Лямбды?',
            question: 'Какой шаг последний?',
            options: [
              { label: 'Закоммитить', correct: true, reply: 'Да: изучить → спланировать → сделать → закоммитить.' },
              { label: 'Спланировать заново', reply: 'План уже выполнен. Осталось сохранить работу.' },
              { label: 'Ничего — ремонт закончен', reply: 'Пока работа не в истории git, она не закончена.' },
            ],
            hints: ['Работу нужно сохранить в истории.', 'Последний шаг — commit.'],
            explain: 'Explore → Plan → Implement → Commit: рекомендуемый порядок для больших задач. Для мелочей хватит прямой просьбы.',
          },
          {
            id: 's6',
            kind: 'command',
            prompt: 'claude',
            task: 'Попроси Claude закоммитить исправление крана.',
            accept: [`${WORDS}(?=.*(?:комм?ит|commit)).{6,}`],
            example: 'закоммить исправление крана',
            hints: ['Коммит можно попросить словами.', 'Например: «закоммить исправление крана».'],
            wrong: [
              { match: '! ?git commit.*', reply: 'Можно и самому, но попроси Claude: он посмотрит diff и напишет сообщение.' },
              { match: '/commit.*', reply: 'Такой команды тут нет — просто попроси словами.' },
            ],
            output: [
              tool('Bash(git add src/grip.ts tests/grip.test.ts)'),
              tool('Bash(git commit -m "fix(crane): release only on touchdown")'),
              result('[main 4e1b9c2] fix(crane): release only on touchdown'),
              result('2 files changed, 19 insertions(+), 1 deletion(-)'),
              dim('Кран плавно ставит контейнер на платформу. Ни звука.'),
            ],
            explain: 'Claude сам смотрит diff и пишет понятное сообщение коммита. План, правка, проверка, коммит — ремонт закончен.',
          },
        ],
      },
    },

    // ───────────── t3 · Esc, Esc Esc, /rewind and its limits ─────────────
    {
      id: 't3',
      title: 'Поворотный круг',
      required: true,
      requires: ['t2'],
      challenge: {
        title: 'Стоп-кран',
        brief: 'Поворотный круг проскакивает нужный путь, и локомотив встаёт боком. Чинить нужно одну функцию — следи, чтобы Claude не увлёкся.',
        cwd: '~/city/turntable',
        unlocks: ['key-esc', 'key-esc-esc', 'slash-rewind', 'concept-checkpoints'],
        steps: [
          {
            id: 's1',
            kind: 'command',
            prompt: 'claude',
            task: 'Попроси Claude исправить поворотный круг: он проскакивает нужный путь.',
            accept: [`${WORDS}(?=.*(?:круг|поворот|turntable|проскак|overshoot|путь|track|${FIX})).{8,}`],
            example: 'исправь круг: он проскакивает нужный путь',
            hints: ['Обычная просьба словами.', 'Например: «исправь круг: он проскакивает нужный путь».'],
            wrong: [
              { match: `${YES}`, reply: 'Скажи, что сделать: исправить поворотный круг.' },
              { match: '/(?!exit$|quit$).*', reply: 'Команда не нужна — попроси Claude словами.' },
            ],
            output: [
              tool('Read(src/turntable.ts)'),
              result('Read 140 lines'),
              say('Модуль старый. Перепишу его целиком — так надёжнее.'),
              tool('Edit(src/turntable.ts)'),
              del('export function rotateTo(track: number) {'),
              del('  motor.run(angleOf(track));'),
              del('export function lockBridge() {'),
              say('Удаляю старый код поворота и замков… пишу новый…'),
            ],
            explain: 'Claude иногда берётся за больше, чем просили. Главное — заметить это сразу.',
          },
          {
            id: 's2',
            kind: 'key',
            task: 'Стоп! Claude переписывает весь модуль, а сломана одна функция. Останови его сейчас же.',
            keys: ['Escape'],
            example: 'Esc',
            hints: ['Стоп-кран у Claude — одна клавиша.', 'Та, что всё отменяет: Esc.'],
            output: [dim('Остановлено. Claude ждёт твоих слов.')],
            explain: 'Esc останавливает ответ или команду на полуслове. Сделанное до этого остаётся — в том числе правки в файлах.',
          },
          {
            id: 's3',
            kind: 'key',
            task: 'Claude успел испортить src/turntable.ts. Открой меню перемотки — клавишами, на пустой строке.',
            keys: ['Escape', 'Escape'],
            example: 'Esc Esc',
            hints: ['Ту же клавишу, что останавливает Claude, нажми дважды.', 'Esc, Esc — на пустой строке.'],
            explain: 'Esc Esc на пустой строке открывает перемотку (если в строке текст — стирает его). То же меню даёт команда /rewind.',
          },
          {
            id: 's4',
            kind: 'choice',
            style: 'quiz',
            task: 'Верни к точке перед запросом и код, и разговор.',
            context: [dim('Выбрана точка перемотки: твой запрос про поворотный круг.')],
            question: 'Что восстановить?',
            options: [
              { label: 'Restore code and conversation', correct: true, reply: 'И файл, и разговор вернулись к точке перед запросом.' },
              { label: 'Restore conversation', reply: 'Разговор вернётся, а испорченный файл останется.' },
              { label: 'Restore code', reply: 'Код вернётся, но неудачная попытка останется в разговоре и будет сбивать Claude.' },
              { label: 'Summarize from here', reply: 'Это сожмёт разговор с этой точки, но код не вернёт.' },
              { label: 'Summarize up to here', reply: 'Сжатие ничего не откатывает.' },
              { label: 'Never mind', reply: 'Меню закроется, а файл останется испорченным.' },
            ],
            hints: ['Нужно вернуть две вещи сразу.', 'Код (code) и разговор (conversation).'],
            output: [dim('src/turntable.ts и разговор вернулись к точке перед запросом.')],
            explain: 'Каждый твой запрос — точка перемотки, и точки переживают возобновление сессии. Пункты с кодом появляются, когда Claude правил файлы.',
          },
          {
            id: 's5',
            kind: 'choice',
            style: 'quiz',
            task: 'Семафор спрашивает: а если бы Claude стёр файл командой rm, перемотка бы его вернула?',
            question: 'Вернёт ли перемотка файл, удалённый через rm?',
            options: [
              { label: 'Нет: изменения от команд Bash не отслеживаются', correct: true, reply: 'Да, это главный предел перемотки.' },
              { label: 'Да: перемотка возвращает всё', reply: 'Не всё: она помнит только правки самого Claude, а не команды.' },
              { label: 'Да, если нажать Esc трижды', reply: 'Третьего Esc нет. Изменения от команд перемотка не видит.' },
            ],
            hints: ['Перемотка следит за правками Claude, а не за командами.', 'rm — это команда Bash.'],
            explain: 'Перемотка — не замена git: не видит команд Bash, внешних правок и правок субагентов. Важное — коммить.',
          },
          {
            id: 's6',
            kind: 'command',
            prompt: 'claude',
            task: 'Теперь попроси точнее: исправить только функцию rotateTo в src/turntable.ts, остальное не трогать.',
            accept: [`${WORDS}(?=.*(?:rotate|функци|только|only)).{10,}`],
            example: 'исправь только rotateTo в @src/turntable.ts, остальное не трогай',
            hints: ['Назови функцию и скажи, чего не трогать.', 'Например: «исправь только rotateTo в @src/turntable.ts, остальное не трогай».'],
            wrong: [
              { match: `${YES}`, reply: 'Скажи точно: исправь только функцию rotateTo.' },
              { match: `${WORDS}(?!.*(?:rotate|функци|только|only)).{6,}`, reply: 'Уточни: только функция rotateTo, остальное не трогать.' },
            ],
            output: [
              tool('Edit(src/turntable.ts)'),
              del('  motor.run(angleOf(track));'),
              add('  motor.runUntil(angleOf(track), sensor.aligned);'),
              tool('Bash(npm test)'),
              result('15 passed'),
              say('Круг останавливается по датчику, а не по таймеру мотора.'),
              dim('Локомотив разворачивается и точно встаёт на третий путь.'),
            ],
            explain: 'Остановил, откатил, попросил точнее — обычный ритм работы. Esc — не провал, а руль.',
          },
        ],
      },
    },

    // ───────────── t4 · bonus: /permissions, rules, --dangerously-skip-permissions ─────────────
    {
      id: 't4',
      title: 'Склад запчастей',
      required: false,
      challenge: {
        title: 'Замок на рычаге',
        brief:
          'На складе запчастей в файле .env лежат ключи от всех ворот депо. Кладовщик хочет, чтобы Claude работал быстро, но к ключам не прикасался.',
        cwd: '~/city/parts-store',
        unlocks: ['slash-permissions', 'concept-permission-rules', 'concept-rule-order', 'cli-dangerously-skip-permissions'],
        steps: [
          {
            id: 's1',
            kind: 'command',
            prompt: 'claude',
            task: 'Посмотри, какие правила разрешений уже действуют на складе.',
            accept: ['/permissions'],
            example: '/permissions',
            hints: ['У правил разрешений своя слэш-команда.', 'По-английски «разрешения» — permissions.'],
            wrong: [
              { match: 'permissions', reply: 'Почти! Нужен слэш в начале.' },
              { match: '/config(?: .*)?', reply: 'Это общие настройки. Правила разрешений собраны в своей команде.' },
              { match: '/(?:allow|deny|rules|access)(?: .*)?', reply: 'Такой команды нет. Нужна «разрешения» — по-английски.' },
            ],
            output: [box('Allow   Bash(npm run *)'), box('Ask     —'), box('Deny    —'), dim('Здесь правила смотрят, добавляют и удаляют.')],
            explain: '/permissions показывает правила по файлам настроек, добавляет и удаляет allow, ask и deny и показывает, что отклонил auto mode.',
          },
          {
            id: 's2',
            kind: 'choice',
            style: 'quiz',
            task: 'Ключи лежат в .env. Claude не должен читать этот файл ни в каком режиме. Какое правило нужно?',
            question: 'Какое правило закроет .env?',
            options: [
              { label: 'deny: Read(./.env)', correct: true, reply: 'Запрет действует в любом режиме.' },
              { label: 'allow: Read(./.env)', reply: 'Это разрешение, а нужен запрет.' },
              { label: 'Строчка в CLAUDE.md: «не читай .env»', reply: 'Памятка — совет, а не замок. Нужно правило.' },
            ],
            hints: ['Нужен запрет, а не совет.', 'Запрет — deny, чтение — Read.'],
            explain: 'Правило пишут как инструмент и его цель: Read(./.env), Bash(npm run *), Edit(/src/**/*.ts).',
          },
          {
            id: 's3',
            kind: 'command',
            prompt: 'claude',
            task: 'Попроси Claude добавить это правило в .claude/settings.json склада.',
            accept: [`${WORDS}(?=.*env)(?=.*(?:deny|запре|нельз|закр|блок|block)).{10,}`],
            example: 'добавь в .claude/settings.json правило deny: Read(./.env)',
            hints: ['Попроси словами и назови правило.', 'Например: «добавь в .claude/settings.json правило deny: Read(./.env)».'],
            wrong: [
              { match: `${WORDS}(?=.*(?:claude\\.md|памятк)).*`, reply: 'Памятка — совет. Нужно правило в .claude/settings.json.' },
              { match: `${WORDS}(?!.*env).*(?:deny|запре|нельз|закр|блок|block).*`, reply: 'Что запретить? Чтение файла .env.' },
            ],
            output: [
              tool('Edit(.claude/settings.json)'),
              code('"permissions": {'),
              code('  "allow": ["Bash(npm run *)"],'),
              add('  "deny": ["Read(./.env)"]'),
              code('}'),
              say('Готово: .env закрыт для чтения в любом режиме.'),
            ],
            explain: 'В .claude/settings.json правила общие для команды, в .claude/settings.local.json — только твои. Списки из разных файлов складываются.',
          },
          {
            id: 's4',
            kind: 'choice',
            style: 'quiz',
            task: 'Есть правила allow Bash(git *) и deny Bash(git push *). Claude хочет выполнить git push. Что будет?',
            question: 'Что сработает?',
            options: [
              { label: 'Запрет: deny проверяется первым', correct: true, reply: 'Да: сначала deny, потом ask, потом allow.' },
              { label: 'Разрешение: allow шире', reply: 'Ширина не важна. Порядок такой: deny, ask, allow.' },
              { label: 'Claude спросит тебя', reply: 'Спрашивает правило ask, а здесь первым сработает deny.' },
            ],
            hints: ['У правил есть порядок проверки.', 'Запрет всегда проверяется первым.'],
            explain: 'Порядок: deny → ask → allow, решает первое совпадение. Deny-правила действуют в любом режиме.',
          },
          {
            id: 's5',
            kind: 'choice',
            style: 'quiz',
            task: 'Кладовщик предлагает: «Запускай Claude с --dangerously-skip-permissions, чтобы не спрашивал!» Что ответишь?',
            question: 'Когда уместен этот флаг?',
            options: [
              { label: 'Только в песочнице без доступа в интернет', correct: true, reply: 'Так и сказано в справке claude --help.' },
              { label: 'Сейчас: склад заработает быстрее', reply: 'Быстрее — и без единого вопроса. Для склада с ключами слишком рискованно.' },
              { label: 'Всегда: deny-правила всё равно работают', reply: 'Deny работают, но всё остальное пойдёт без вопросов. Безопаснее auto mode или узкие allow.' },
            ],
            hints: ['В названии флага есть слово dangerously.', 'Справка советует его только для изолированных песочниц.'],
            explain:
              'Флаг включает режим bypassPermissions: всё идёт без вопросов, держат только правила deny и ask. Для живых систем есть auto mode и узкие allow-правила.',
          },
        ],
      },
    },

    // ───────────── t5 · bonus: /model, /effort, ultrathink, a check Claude can run ─────────────
    {
      id: 't5',
      title: 'Диспетчерская',
      required: false,
      challenge: {
        title: 'Глубже и с проверкой',
        brief: 'В диспетчерской составляют расписание всех поездов депо. Задача трудная: составы то и дело встречаются на одном пути.',
        cwd: '~/city/dispatch',
        unlocks: ['slash-model', 'slash-effort', 'concept-ultrathink', 'concept-verify-check'],
        steps: [
          {
            id: 's1',
            kind: 'command',
            prompt: 'claude',
            task: 'Задача трудная. Открой выбор модели и посмотри, какие есть.',
            accept: ['/model(?: .+)?'],
            example: '/model',
            hints: ['Модель выбирают слэш-командой.', 'По-английски «модель» — model.'],
            wrong: [
              { match: 'model', reply: 'Почти! Нужен слэш в начале.' },
              { match: '/effort(?: .*)?', reply: 'Это глубина рассуждений. Модель выбирают другой командой.' },
              { match: '/config(?: .*)?', reply: 'В настройках долго искать. У модели есть своя команда.' },
            ],
            output: [
              box('default   Opus 5.5'),
              box('best      Fable, если доступна, иначе Opus'),
              box('opus      Opus 5.5'),
              box('sonnet    Sonnet 5.5'),
              box('haiku'),
              dim('Выбор станет моделью по умолчанию. Клавиша s — только для этой сессии.'),
            ],
            explain: '/model сохраняет выбор для новых сессий, а s в списке меняет модель только сейчас. Там же стрелками меняют усилие.',
          },
          {
            id: 's2',
            kind: 'command',
            prompt: 'claude',
            task: 'Opus 5.5 по умолчанию думает на среднем усилии. Подними усилие на одну ступень — для всей этой работы.',
            accept: ['/effort high'],
            example: '/effort high',
            hints: [
              'У усилия своя слэш-команда — «усилие» по-английски.',
              'Команда /effort. Ступени: low, medium, high, xhigh, max; среднее — medium.',
              'Шаблон: /effort <ступень после medium>',
            ],
            wrong: [
              { match: '/effort (?:xhigh|max)', reply: 'Это больше чем на ступень: после medium идёт high.' },
              { match: '/effort (?:low|medium|auto)', reply: 'Это не выше среднего. Нужна ступень после medium.' },
              { match: '/effort', reply: 'Допиши уровень: low, medium, high, xhigh или max.' },
              { match: THINK_HARD, reply: '«think hard» теперь обычные слова. Усилие задаёт команда /effort.' },
            ],
            output: [dim('Усилие: high.')],
            explain: '/effort задаёт глубину рассуждений: low, medium, high, xhigh, max или auto. Сложным задачам — выше, простым и быстрым — ниже.',
          },
          {
            id: 's3',
            kind: 'command',
            prompt: 'claude',
            task: 'Для одного самого трудного вопроса — почему составы встречаются на пути 3 — попроси Claude подумать особенно глубоко.',
            accept: [`${WORDS}(?=.*ultrathink).{12,}`],
            example: 'ultrathink: почему составы встречаются на пути 3?',
            hints: ['Для одного глубокого хода есть особое слово прямо в просьбе.', 'Слово начинается с ultra… и кончается на …think.'],
            wrong: [
              { match: THINK_HARD, reply: '«think hard» теперь обычные слова. Для одного глубокого хода есть слово ultrathink.' },
              {
                match: '(?!.*ultrathink)(?=.*(?:подумай|думай|глубж|глубок|think)).*',
                reply: 'Особое слово для одного глубокого хода — ultrathink. Добавь его в просьбу.',
              },
              { match: '/effort(?: .*)?', reply: 'Усилие уже поднято для всей работы. А для одного хода есть слово прямо в просьбе.' },
            ],
            output: [
              dim('Thought for 38s'),
              say('Составы встречаются на пути 3: занятость путей обновляется раз'),
              say('в пять минут, и оба графика считают путь свободным в 06:10.'),
            ],
            explain: 'ultrathink в просьбе даёт один ход глубокого рассуждения и не меняет усилие сессии. А «think hard» теперь просто слова.',
          },
          {
            id: 's4',
            kind: 'choice',
            style: 'quiz',
            task: 'Причина ясна. Как попросить исправление, чтобы Claude сам проверял свою работу?',
            question: 'Какая просьба лучше?',
            options: [
              { label: 'Исправь и гоняй npm run simulate до 0 встреч', correct: true, reply: 'У Claude есть проверка — он сам увидит, получилось ли.' },
              { label: 'Исправь, а я потом сам проверю', reply: 'Тогда проверкой становишься ты — и гоняешь симулятор вручную.' },
              { label: 'Исправь как следует и без ошибок', reply: 'Пожелание — не проверка. Claude нечем убедиться, что всё вышло.' },
            ],
            hints: ['Лучшая просьба даёт Claude способ проверить себя.', 'Тест, сборка или симулятор, которые он запустит сам.'],
            explain: 'Совет №1 из документации: дай Claude проверку, которую он может запустить, — тесты, сборку, скриншот. Иначе проверкой становишься ты.',
          },
          {
            id: 's5',
            kind: 'command',
            prompt: 'claude',
            task: 'Попроси Claude исправить расписание и проверить его симулятором npm run simulate.',
            accept: [`${WORDS}(?=.*(?:simulat|симул|npm run|тест|test|провер|check)).{10,}`],
            example: 'исправь расписание и гоняй npm run simulate, пока не будет 0 встреч',
            hints: ['Попроси исправить — и назови проверку.', 'Например: «исправь расписание и гоняй npm run simulate, пока не будет 0 встреч».'],
            wrong: [
              { match: '! ?npm run simulate.*', reply: 'Запустить можно и самому, но пусть Claude проверяет свою работу сам.' },
              { match: `${YES}`, reply: 'Скажи, что сделать и чем проверить: npm run simulate.' },
              { match: `${WORDS}(?!.*(?:simulat|симул|npm run|тест|test|провер|check)).{6,}`, reply: 'Добавь проверку: пусть Claude прогонит npm run simulate.' },
            ],
            output: [
              tool('Edit(src/occupancy.ts)'),
              del('const REFRESH_MS = 300_000;'),
              add('const REFRESH_MS = 5_000;'),
              tool('Bash(npm run simulate)'),
              result('240 trains · 0 conflicts'),
              say('Занятость путей обновляется каждые 5 секунд. Симулятор:'),
              say('240 поездов, ни одной встречи.'),
              dim('На табло диспетчерской зеленеет новое расписание.'),
            ],
            explain: 'С проверкой Claude сам видит результат и правит, пока не выйдет. Правило документации: не можешь проверить — не выпускай.',
          },
        ],
      },
    },
  ],

  npcs: [
    {
      id: 'lambda',
      name: 'Лямбда',
      model: 'npc_round',
      tint: '#ffe14a',
      dialogs: [
        {
          when: { gateOpen: true },
          lines: [
            { text: 'Ворота открыты. Стрелки, кран, круг — всё на ходу. Хорошая смена.', mood: 'happy' },
            { text: 'Три правила теперь твои: думай до, тормози вовремя, держи рычаги на замке.', mood: 'neutral' },
            { text: 'Дальше Квартал Инструментов. Там Тётя Сима: продаст тебе переходники, рецепты и крючки для Claude.', mood: 'happy' },
            { text: 'Бип! А торговаться можно?', speaker: 'ХАРНИ', mood: 'thinking' },
            { text: 'С Симой? Попробуй. Потом расскажешь.', mood: 'happy' },
          ],
        },
        {
          when: { done: ['t2'], notDone: ['t3'] },
          lines: [
            { text: 'Кран ставит контейнеры, как пёрышки. План сработал.', mood: 'happy' },
            { text: 'Правило второе: тормози вовремя. Даже с планом Claude иногда сворачивает не туда.', mood: 'thinking' },
            { text: 'Увидел — останавливай сразу, на полуслове. А если он уже натворил дел — отмотай назад.', mood: 'neutral' },
            { text: 'Поворотный круг как раз капризничает. Иди туда — и держи руку на стоп-кране.', mood: 'worried' },
          ],
        },
        {
          when: { done: ['t1'], notDone: ['t2'] },
          lines: [
            { text: 'Стрелки ходят. Ты понял, где рычаги: строка под вводом всегда говорит, что Claude можно.', mood: 'happy' },
            { text: 'Правило первое: думай до. Большую работу сначала планируют, потом делают.', mood: 'neutral' },
            { text: 'В режиме планирования Claude только читает и предлагает план. Пока не одобришь — ни одной правки.', mood: 'neutral' },
            { text: 'Кран у нас тяжёлый и чужой. Сначала план — потом гаечный ключ.', mood: 'thinking' },
          ],
        },
        {
          when: { notDone: ['t1'] },
          lines: [
            { text: 'Лямбда, бригадир депо. Руки в масле, так что без рукопожатий.', mood: 'neutral' },
            { text: 'Правил у меня три: думай до, тормози вовремя, у каждого рычага — замок.', mood: 'neutral' },
            { text: 'Claude многое может сам. А сколько ему можно — решаешь ты, когда выбираешь режим.', mood: 'thinking' },
            { text: 'Режим виден в строке под вводом. Одно сочетание клавиш — и рычаг в другом положении.', mood: 'neutral' },
            { text: 'Начни со стрелочного поста. Сменщик оставил там рычаг не в том положении.', mood: 'worried' },
          ],
        },
        {
          lines: [
            { text: 'Думай до. Тормози вовремя. Держи рычаги на замке.', mood: 'neutral' },
            { text: 'План дешевле ремонта. Стоп дешевле отката. Откат дешевле аварии.', mood: 'thinking' },
            { text: 'Ступай, смена не ждёт.', mood: 'neutral' },
          ],
        },
      ],
    },
    {
      id: 'semafor',
      name: 'Семафор',
      model: 'npc_tall',
      tint: '#5dff7a',
      dialogs: [
        {
          when: { done: ['t4', 't5'] },
          lines: [
            { text: 'Ключи под замком, поезда разъезжаются. Зелёный по всей линии!', mood: 'happy' },
            { text: 'Запрет сильнее разрешения, а проверка сильнее надежды. Я записал.', mood: 'neutral' },
            { text: 'Машу тебе обеими руками. Это значит «спасибо».', mood: 'happy' },
          ],
        },
        {
          when: { done: ['t4'] },
          lines: [
            { text: 'Склад под замком: к ключам Claude не подойдёт ни в каком режиме.', mood: 'happy' },
            { text: 'А в диспетчерской поезда всё ещё встречаются. Там думать надо глубже — и проверять.', mood: 'worried' },
            { text: 'Терминал за углом. Машу тебе туда.', mood: 'neutral' },
          ],
        },
        {
          when: { done: ['t5'] },
          lines: [
            { text: 'Расписание сошлось: ноль встреч! Ты дал Claude проверку, и он довёл дело сам.', mood: 'happy' },
            { text: 'А склад всё ещё открыт: ключи в .env лежат на виду.', mood: 'worried' },
            { text: 'Повесь на них замок. Правило, а не просьбу.', mood: 'thinking' },
          ],
        },
        {
          lines: [
            { text: 'Семафор! Сигнальщик депо: машу руками — составы едут. Или стоят. Как махну.', mood: 'excited' },
            { text: 'У нас два дела без хозяина: склад, где ключи лежат на виду, и диспетчерская, где поезда встречаются лоб в лоб.', mood: 'worried' },
            { text: 'Терминалы там свои. Заглянешь — помашу тебе зелёным.', mood: 'happy' },
          ],
        },
      ],
    },
  ],

  chips: [
    {
      id: 'c1',
      title: 'План в редакторе',
      text: 'Ctrl+G открывает твой запрос — или план Claude — в текстовом редакторе. Удобно, когда правка длинная.',
      unlocks: ['key-ctrl-g'],
    },
    {
      id: 'c2',
      title: 'Подробный журнал',
      text: 'Ctrl+O открывает подробный журнал разговора: свёрнутые строки вроде «Thought for 4s» там видны целиком.',
      unlocks: ['key-ctrl-o'],
    },
    {
      id: 'c3',
      title: 'Все изменения',
      text: '/diff показывает все изменения в рабочей копии — красным и зелёным, с номерами строк. Перед коммитом — самое то.',
      unlocks: ['slash-diff'],
    },
    {
      id: 'c4',
      title: 'Ревью',
      text: '/code-review (другое имя — /review) просит Claude сделать ревью твоих изменений. Для проверки безопасности есть /security-review.',
      unlocks: ['slash-code-review'],
    },
  ],

  zones: [
    { id: 'z1', text: 'Депо Планов. Пахнет паром и маслом. Где-то шипит клапан.' },
    { id: 'z2', text: 'Поворотный круг. Локомотив застыл на нём боком.', when: { notDone: ['t3'] } },
    { id: 'z3', text: 'Ворота депо. Замок ждёт стрелки, кран и круг.', when: { gateOpen: false } },
  ],
};
