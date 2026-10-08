// Level 1 — «Переулок Загрузки»: first steps (claude, plain prompts, /init and CLAUDE.md, the Bash permission
// dialog, /exit; bonus: specific prompts, claude "task", /help, ?, new line with \ + Enter).
// Facts: docs/claude-code-reference.md §1. Tool rows and screen layouts are flavour (UNVERIFIED there);
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
const QT = `["'][^"']{4,}["']`; // a quoted task
const YES = '(?:да|ага|ок|окей|yes|ok|okay|давай|угу)[.!]*';
const FIX = '(?:исправ|почин|поправ|измен|поменя|сдела|убер|сниз|fix|change|repair)';

export const meta: LevelMeta = {
  title: 'Переулок Загрузки',
  subtitle: 'Первые шаги с Claude Code',
  topics: [
    'Запуск: claude и просьбы обычными словами',
    '/init и памятка CLAUDE.md',
    'Диалог разрешений: Yes, «больше не спрашивать», Esc = No',
    'Выход из сессии: /exit',
    'Бонус: точные просьбы, claude "задача", /help, ?, \\ + Enter',
  ],
  intro: [
    'Нижний город спит под куполом. Ядро, которое им управляло, давно молчит: гаснут фонари, клинит ворота, жители-роботы забыли, как всё это чинить.',
    'В куче железного хлама мигает оранжевый огонёк. Это ты — ХАРНИ, маленький ремонтный робот на гусеницах. Сам код ты не пишешь. Но в старых терминалах города живёт Claude Code — помощник, который читает, правит и запускает код. Ему нужен только оператор.',
    'Цель: зажечь фонари, оживить вывеску лапшичной и сдвинуть ворота переулка.',
  ],
  outro: [
    'Переулок светится. Ты запустил Claude Code, говорил с ним обычными словами, оставил ему памятку CLAUDE.md и научился отвечать на запросы разрешений: где «да», где «больше не спрашивай», а где Esc.',
    'Ворота открыты. Дальше — Рынок Памяти, где помнят всё, что записано, и забывают всё остальное.',
  ],
};

export const lessons: LevelLessons = {
  terminals: [
    // ───────────── t1 · first launch, plain language ─────────────
    {
      id: 't1',
      title: 'Фонари переулка',
      required: true,
      challenge: {
        title: 'Первый запуск',
        brief: 'В переулке темно: фонари не горят уже много циклов. Их код лежит здесь, в ~/city/alley-lights, но ты видишь его впервые.',
        cwd: '~/city/alley-lights',
        unlocks: ['cli-claude', 'concept-plain-language'],
        steps: [
          {
            id: 's1',
            kind: 'command',
            prompt: 'shell',
            task: 'Ты в папке с кодом фонарей. Запусти здесь Claude Code.',
            accept: ['claude'],
            example: 'claude',
            hints: ['Команда — это имя самого помощника.', 'Одно слово строчными буквами: c…e.'],
            wrong: [
              { match: 'claude[ _-]?code(?: .*)?', reply: 'Почти! Команда короче — одно слово.' },
              {
                match: '(?:запусти|включи|открой|start|run|launch|open)(?: .*)?',
                reply: 'Оболочка понимает только команды. Набери само имя помощника — одним словом.',
              },
              { match: '\\./claude|sudo claude', reply: 'Ничего лишнего не нужно: просто имя помощника.' },
            ],
            explain: 'Claude Code работает в той папке, где его запустили: читает её файлы и выполняет в ней команды.',
          },
          {
            id: 's2',
            kind: 'command',
            prompt: 'claude',
            task: 'Спроси Claude обычными словами, что делает этот проект.',
            accept: [`${WORDS}.{8,}`],
            example: 'что делает этот проект?',
            hints: ['Команды не нужны: пиши, как спросил бы знакомого робота.', 'Например: «что делает этот проект?»'],
            wrong: [
              { match: '/.*', reply: 'Слэш-команды не нужны: просто спроси словами, по-русски или по-английски.' },
              { match: '[!#].*', reply: 'Знаки в начале не нужны: просто напиши вопрос словами.' },
            ],
            output: [tool('Read(README.md)'), result('Read 31 lines'), say('Это щиток фонарей переулка: ночью он включает шесть линий ламп.')],
            explain: 'Код показывать не нужно — Claude сам находит и читает нужные файлы. Знакомство с чужим проектом удобно начинать с вопроса.',
          },
          {
            id: 's3',
            kind: 'command',
            prompt: 'claude',
            task: 'Но фонари не горят. Спроси Claude, почему щиток их не включает.',
            accept: [`${WORDS}(?=.*(?:фонар|свет|ламп|щит|включ|гор|темн|почему|light|lamp|why)).{8,}`],
            example: 'почему щиток не включает фонари?',
            hints: ['Снова вопрос обычными словами.', 'Например: «почему щиток не включает фонари?»'],
            wrong: [
              { match: '/.*', reply: 'Команда тут не поможет. Спроси Claude словами, в чём дело.' },
              { match: `${YES}`, reply: 'Claude ждёт вопроса. Спроси, почему фонари не включаются.' },
              {
                match: `${WORDS}(?!.*(?:фонар|свет|ламп|щит|включ|гор|темн|почему|light|lamp|why)).{8,}`,
                reply: 'Спроси про фонари: почему щиток их не включает?',
              },
            ],
            output: [
              tool('Read(src/switch.ts)'),
              result('Read 48 lines'),
              tool('Read(config/sensor.json)'),
              result('Read 6 lines'),
              say('Щиток включает фонари, только когда датчик видит темноту:'),
              say('меньше 9000 люкс. Ночью датчик показывает 3 люкса, но в коде'),
              say('сравнение перевёрнуто — и щиток считает, что сейчас день.'),
            ],
            explain: 'Сначала понять, потом чинить. Вопрос «почему» даёт Claude найти причину, а тебе — проверить, согласен ли ты с ней.',
          },
          {
            id: 's4',
            kind: 'command',
            prompt: 'claude',
            task: 'Причина найдена. Попроси Claude исправить её, чтобы фонари включались в темноте.',
            accept: [`${WORDS}(?=.*(?:${FIX}|переверн|сравнен|порог)).{6,}`],
            example: 'исправь сравнение, чтобы фонари включались в темноте',
            hints: ['Скажи Claude, что сделать, — так же просто, как спрашивал.', 'Например: «исправь сравнение, чтобы фонари включались в темноте».'],
            wrong: [
              { match: `${YES}`, reply: 'Claude ждёт просьбу, а не «да». Скажи, что сделать: например, исправить сравнение.' },
              { match: '/.*', reply: 'Слэш-команда тут не нужна — попроси словами.' },
              {
                match: `${WORDS}(?!.*(?:${FIX}|переверн|сравнен|порог)).{6,}`,
                reply: 'Попроси прямо: исправь сравнение, чтобы фонари включались в темноте.',
              },
            ],
            output: [
              tool('Edit(src/switch.ts)'),
              del('if (lux > config.darkBelow) lightsOn();'),
              add('if (lux < config.darkBelow) lightsOn();'),
              tool('Bash(npm test)'),
              result('6 passed'),
              say('Готово: теперь фонари включаются, когда темно.'),
              dim('Вдоль переулка один за другим загораются фонари.'),
            ],
            explain:
              'Сессия началась в auto mode (⏵⏵ auto mode on): Claude сам правит файлы и запускает тесты, а фоновый классификатор проверяет его действия.',
          },
        ],
      },
    },

    // ───────────── t2 · /init and CLAUDE.md ─────────────
    {
      id: 't2',
      title: 'Вывеска лапшичной',
      required: true,
      requires: ['t1'],
      challenge: {
        title: 'Памятка для Claude',
        brief:
          'Вывеска лапшичной мигает и гаснет. Каждый новый ремонтник сначала час разбирается в её коде — и ничего не записывает для следующего.',
        cwd: '~/city/noodle-sign',
        unlocks: ['slash-init', 'file-claude-md', 'concept-claude-md-rules'],
        steps: [
          {
            id: 's1',
            kind: 'command',
            prompt: 'shell',
            task: 'Ты у кода вывески. Открой сессию Claude Code.',
            accept: ['claude'],
            example: 'claude',
            hints: ['Так же, как у фонарей.', 'Одно слово — имя помощника.'],
            wrong: [
              { match: 'claude[ _-]?code(?: .*)?', reply: 'Почти! Команда короче — одно слово.' },
              { match: `claude ["']?/init["']?`, reply: 'Сначала просто открой сессию — команды наберёшь внутри.' },
              { match: '/.*', reply: 'Слэш-команды работают внутри Claude Code. Сначала запусти его.' },
            ],
            explain: 'Каждый ремонт начинается одинаково: перейти в папку проекта и запустить claude.',
          },
          {
            id: 's2',
            kind: 'command',
            prompt: 'claude',
            task: 'Пусть Claude изучит проект и сам напишет для него памятку CLAUDE.md. Для этого есть одна команда.',
            accept: ['/init'],
            example: '/init',
            hints: ['Это слэш-команда: она начинается с «/».', 'От английского initialize — «подготовить, начать».', 'Четыре буквы после слэша: /i…t.'],
            wrong: [
              { match: 'init', reply: 'Почти! Команды Claude Code начинаются со слэша.' },
              { match: '/(?:claude(?:\\.md)?|create|new|readme|memory)(?: .*)?', reply: 'Не та команда. Памятку по коду проекта пишет команда «подготовки» — от initialize.' },
              {
                match: `${WORDS}(?=.*(?:claude\\.md|памятк)).{6,}`,
                reply: 'Сработало бы и так! Но для первой памятки есть готовая команда — потренируй её.',
              },
            ],
            output: [
              tool('Read(package.json)'),
              result('Read 24 lines'),
              tool('Read(src/sign.ts)'),
              result('Read 88 lines'),
              tool('Write(CLAUDE.md)'),
              result('Wrote 16 lines'),
              say('Создал CLAUDE.md: как собрать и проверить вывеску и как устроен код.'),
            ],
            explain: 'Если CLAUDE.md уже есть, /init не перезапишет его, а предложит улучшения. После /init допиши то, чего Claude не узнает из кода.',
          },
          {
            id: 's3',
            kind: 'choice',
            style: 'quiz',
            task: 'Посмотри, что Claude записал в памятку. Когда он её прочтёт?',
            context: [
              dim('CLAUDE.md:'),
              code('# Noodle sign controller'),
              code('- Build: npm run build'),
              code('- Test: npm test'),
              code('- src/sign.ts drives the tubes, src/blink.ts the animations'),
            ],
            question: 'Когда Claude читает CLAUDE.md?',
            options: [
              { label: 'В начале каждой сессии в этой папке', correct: true, reply: 'Да: памятка загружается сама, каждый раз.' },
              { label: 'Только если попросить его прочесть файл', reply: 'Нет: CLAUDE.md загружается сам, просить не нужно.' },
              { label: 'Один раз — сразу после /init', reply: 'Нет: памятка нужна каждой новой сессии, и Claude читает её каждый раз.' },
            ],
            hints: ['Памятка нужна, чтобы новой сессии не пришлось всё узнавать заново.', 'Просить прочесть её не нужно.'],
            explain: 'CLAUDE.md — первое, что Claude узнаёт о проекте в каждой новой сессии. Его кладут в git, и памятка достаётся всей команде.',
          },
          {
            id: 's4',
            kind: 'command',
            prompt: 'claude',
            task: 'Мама Сокет просит: яркость вывески — не выше 80%, иначе трубки перегорят. Попроси Claude записать это правило в CLAUDE.md.',
            accept: [`${WORDS}(?=.*(?:claude[ .]?md|памятк))(?=.*(?:80|ярк|bright)).{12,}`],
            example: 'добавь в CLAUDE.md правило: яркость вывески не выше 80%',
            hints: [
              'Просто попроси словами — и назови файл.',
              'Нужны две вещи: файл CLAUDE.md и само правило про 80%.',
              'Например: «добавь в CLAUDE.md правило: яркость вывески не выше 80%».',
            ],
            wrong: [
              { match: '#.*', reply: 'Быстрой записи через # больше нет. Просто попроси словами: «добавь в CLAUDE.md…».' },
              {
                match: `${WORDS}(?!.*(?:claude[ .]?md|памятк))(?=.*(?:80|ярк|bright)).*`,
                reply: 'Claude послушает сейчас, но следующая сессия этого не узнает. Попроси записать правило в CLAUDE.md.',
              },
              { match: `${WORDS}(?=.*(?:claude[ .]?md|памятк))(?!.*(?:80|ярк|bright)).*`, reply: 'Какое правило записать? Назови его: яркость не выше 80%.' },
              { match: '/(?:init|memory)(?: .*)?', reply: 'Команда тут не нужна. Попроси Claude словами: «добавь в CLAUDE.md…».' },
            ],
            output: [
              tool('Edit(CLAUDE.md)'),
              add('## Правила'),
              add('- Яркость вывески — не выше 80%, иначе трубки перегорят.'),
              say('Записал правило в CLAUDE.md.'),
            ],
            explain:
              'В памятку пишут то, что Claude не узнает из кода: правила, договорённости, подвохи. Держи её короткой — примерно до 200 строк.',
          },
          {
            id: 's5',
            kind: 'command',
            prompt: 'claude',
            task: 'Теперь попроси Claude починить мигание вывески.',
            accept: [`${WORDS}(?=.*(?:вывеск|миг|sign|blink|flicker|${FIX})).{8,}`],
            example: 'почини мигание вывески',
            hints: ['Обычная просьба словами.', 'Например: «почини мигание вывески».'],
            wrong: [
              { match: '/.*', reply: 'Команда не нужна — просто попроси починить вывеску.' },
              { match: `${YES}`, reply: 'Скажи, что сделать: починить мигание вывески.' },
            ],
            output: [
              tool('Read(src/sign.ts)'),
              result('Read 88 lines'),
              tool('Edit(src/sign.ts)'),
              del('const BRIGHTNESS = 1.0;'),
              add('const BRIGHTNESS = 0.8; // CLAUDE.md: не выше 80%'),
              tool('Bash(npm test)'),
              result('12 passed'),
              say('Трубки мигали от перегрева на полной яркости. Поставил 80% —'),
              say('как велит правило в CLAUDE.md.'),
              dim('Над лапшичной ровно загорается вывеска ЛАПША.'),
            ],
            explain: 'Ты не напоминал про 80% — Claude взял правило из памятки. Так CLAUDE.md помнит за тебя в каждой новой сессии.',
          },
        ],
      },
    },

    // ───────────── t3 · Manual mode: the Bash permission dialog, Esc = No, /exit ─────────────
    {
      id: 't3',
      title: 'Привод ворот',
      required: true,
      requires: ['t2'],
      challenge: {
        title: 'Спроси разрешения',
        brief:
          'Ворота переулка заклинило. Их терминал старые операторы запускали командой claude --permission-mode manual: здесь Claude спрашивает разрешения перед каждой командой.',
        cwd: '~/city/gate-drive',
        startMode: 'manual',
        unlocks: ['concept-permission-dialog', 'key-esc-no', 'slash-exit'],
        steps: [
          {
            id: 's1',
            kind: 'command',
            prompt: 'claude',
            task: 'Сессия уже идёт — в ручном режиме, ⏸ manual mode on. Спроси Claude, почему ворота не открываются.',
            accept: [`${WORDS}(?=.*(?:ворот|створ|привод|заклин|открыв|почему|gate|drive|why|stuck)).{8,}`],
            example: 'почему ворота не открываются?',
            hints: ['Вопрос обычными словами — как у фонарей.', 'Например: «почему ворота не открываются?»'],
            wrong: [
              { match: '/(?!exit$|quit$).*', reply: 'Команда тут не нужна. Спроси Claude словами, что с воротами.' },
              { match: `${YES}`, reply: 'Claude ждёт вопроса. Спроси, почему ворота не открываются.' },
            ],
            output: [
              tool('Read(src/drive.ts)'),
              result('Read 64 lines'),
              tool('Read(logs/drive.log)'),
              result('Read 120 lines'),
              say('В журнале: «limit switch: position unknown». Привод не знает,'),
              say('где створки, и не двигается. Сначала прогоню тесты.'),
            ],
            explain: 'Читать файлы в рабочей папке Claude может и в ручном режиме без спроса. А правки и большинство команд он сначала покажет тебе.',
          },
          {
            id: 's2',
            kind: 'choice',
            style: 'permission',
            task: 'Claude просит разрешения на тесты. Они ничего не ломают и ещё понадобятся. Разреши — и так, чтобы про них больше не спрашивал.',
            permission: { tool: 'Bash command', description: 'Run the gate drive tests', command: 'npm test', note: 'This command requires approval' },
            question: 'Do you want to proceed?',
            options: [
              { label: 'Yes', reply: 'Тесты пойдут, но в следующий раз Claude спросит снова. Нужно «да» с правилом на будущее.' },
              {
                label: "Yes, and don't ask again for: npm test *",
                correct: true,
                reply: 'Правило записано в .claude/settings.local.json. Про npm test Claude больше не спросит.',
              },
              { label: 'No', esc: true, reply: 'Тесты безопасны, а без них Claude не проверит привод.' },
            ],
            hints: ['«don\'t ask again» значит «больше не спрашивай».', 'Нужен вариант 2: «да» — и правило на будущее.'],
            output: [
              tool('Bash(npm test)'),
              result('1 failed · 7 passed'),
              result('limit switch: expected 0…1000, got -12'),
              say('Датчик положения сбился: показывает -12. Его надо откалибровать.'),
            ],
            explain:
              'Вариант 2 сохраняет правило в .claude/settings.local.json — только для этого репозитория. Его дают безопасным командам, которые нужны часто.',
          },
          {
            id: 's3',
            kind: 'choice',
            style: 'permission',
            task: 'Claude хочет открыть ворота силой. Без датчика створки сорвут цепь. Откажи — быстрее всего одной клавишей.',
            context: [say('Можно и без калибровки: открою ворота принудительно.')],
            permission: {
              tool: 'Bash command',
              description: 'Force the gate open without the sensor',
              command: 'npm run force-open',
              note: 'This command requires approval',
            },
            question: 'Do you want to proceed?',
            options: [
              { label: 'Yes', reply: 'Створки рванут вслепую и сорвут цепь. Откажи.' },
              { label: "Yes, and don't ask again for: npm run force-open *", reply: 'Ещё хуже: так Claude сможет рвать ворота без спроса и дальше.' },
              { label: 'No', correct: true, esc: true, reply: 'Отказано. Ворота целы.' },
            ],
            hints: ['В этом диалоге «нет» говорит одна клавиша — та, что всё отменяет.', 'Esc здесь значит No.'],
            output: [say('Понял, силой не открываю. Как поступим?')],
            explain: 'Esc в диалоге разрешений — это No. Отказ ничего не ломает: Claude остановится и спросит, как быть.',
          },
          {
            id: 's4',
            kind: 'command',
            prompt: 'claude',
            task: 'Скажи Claude, как надо: сначала откалибровать датчик положения.',
            accept: [`${WORDS}(?=.*(?:калибр|calibr)).{6,}`],
            example: 'сначала откалибруй датчик положения',
            hints: ['Ответь словами, как поступить вместо этого.', 'Например: «сначала откалибруй датчик положения».'],
            wrong: [
              {
                match: `${WORDS}(?!.*(?:калибр|calibr))(?=.*(?:сил|принуд|force|открой|open)).*`,
                reply: 'Силой и вслепую нельзя. Сначала датчик — попроси его откалибровать.',
              },
              { match: `${YES}`, reply: 'Скажи, что делать вместо этого: откалибровать датчик.' },
              { match: '/(?!exit$|quit$).*', reply: 'Команда не нужна — просто скажи Claude, что делать.' },
            ],
            output: [say('Хорошо: сначала калибровка датчика.')],
            explain: 'После отказа скажи, чего хочешь вместо этого. Claude подстроится под твой план.',
          },
          {
            id: 's5',
            kind: 'choice',
            style: 'permission',
            task: 'Калибровка двигает настоящие створки. Разреши её — но только в этот раз.',
            permission: {
              tool: 'Bash command',
              description: 'Calibrate the gate position sensor',
              command: 'npm run calibrate',
              note: 'This command requires approval',
            },
            question: 'Do you want to proceed?',
            options: [
              { label: 'Yes', correct: true, reply: 'Калибровка пошла.' },
              { label: "Yes, and don't ask again for: npm run calibrate *", reply: 'Такие команды лучше видеть каждый раз: они двигают настоящие ворота.' },
              { label: 'No', esc: true, reply: 'Без калибровки ворота так и будут стоять.' },
            ],
            hints: ['Нужно «да» без правила на будущее.', 'Разовое «да» — первый вариант.'],
            output: [
              tool('Bash(npm run calibrate)'),
              result('sensor range 0…1000 · ok'),
              tool('Bash(npm test)'),
              result('8 passed'),
              say('Тесты прошли без вопроса — по твоему правилу. Привод знает,'),
              say('где створки, и снова слушается.'),
              dim('В конце переулка с лязгом оживают ворота.'),
            ],
            explain: 'Разовое «Yes» — для действий с последствиями: решаешь каждый раз сам. А тесты прошли без вопроса — сработало правило из шага с npm test.',
          },
          {
            id: 's6',
            kind: 'command',
            prompt: 'claude',
            task: 'Ремонт закончен. Выйди из Claude Code его собственной командой.',
            accept: ['/exit', '/quit'],
            example: '/exit',
            hints: ['Выход — тоже слэш-команда.', 'По-английски «выход» — exit.'],
            wrong: [
              { match: 'exit|quit', reply: 'Почти! В Claude Code команды начинаются со слэша.' },
              { match: '(?:выход|выйти|выйди|пока|bye)[.!]*', reply: 'Нужна команда — по-английски и со слэшем.' },
              { match: ':q!?|:wq', reply: 'Это из другого редактора. Здесь выход — слэш-команда.' },
            ],
            output: [dim('Сессия закрыта. Терминал вернулся в оболочку.')],
            explain: '/exit (или /quit) закрывает Claude Code. Разрешения «больше не спрашивать» останутся в репозитории и для следующих сессий.',
          },
        ],
      },
    },

    // ───────────── t4 · bonus: specific prompts, claude "task", /help, ?, \ + Enter ─────────────
    {
      id: 't4',
      title: 'Справочная будка',
      required: false,
      challenge: {
        title: 'Точная просьба',
        brief: 'Табло справочной будки застряло на вчерашних объявлениях. Его ремонт начнём прямо с задачи.',
        cwd: '~/city/info-booth',
        unlocks: ['concept-specific-prompts', 'cli-claude-prompt', 'slash-help', 'key-shortcuts', 'key-newline'],
        steps: [
          {
            id: 's1',
            kind: 'command',
            prompt: 'shell',
            task: 'Запусти Claude Code так, чтобы он сразу получил задачу: почини табло.',
            accept: [`claude ${QT}`],
            example: 'claude "почини табло"',
            hints: ['Задачу можно передать прямо при запуске — после слова claude.', 'Возьми задачу в кавычки.', 'Шаблон: claude "<задача>"'],
            wrong: [
              { match: 'claude (?:-p|--print)(?: .*)?', reply: '-p ответит один раз и выйдет. А нужна живая сессия с первой задачей.' },
              { match: 'claude', reply: 'Так откроется пустая сессия. Допиши задачу в кавычках после claude.' },
              { match: `claude [^"'-].*`, reply: 'Возьми задачу в кавычки — иначе оболочка разрежет её на отдельные слова.' },
            ],
            output: [
              tool('Glob(src/**/board*.ts)'),
              result('Found 3 files'),
              say('Табло в проекте три: перрон, рынок и справочная. Какое чинить'),
              say('и что с ним не так?'),
            ],
            explain: 'claude "задача" открывает обычную сессию и сразу отправляет ей первую просьбу. Не путай с claude -p: тот ответит один раз и выйдет.',
          },
          {
            id: 's2',
            kind: 'choice',
            style: 'quiz',
            task: 'Claude не понял, что чинить. Выбери, как ответить.',
            question: 'Какой ответ поможет Claude больше всего?',
            options: [
              {
                label: 'Табло справочной висит на вчерашних объявлениях',
                correct: true,
                reply: 'Ясно, какое табло и как выглядит поломка.',
              },
              { label: 'Ну табло же. Сломанное.', reply: 'Claude снова переспросит: табло три, а что с ним — непонятно.' },
              { label: 'Почини всё', reply: 'Тогда Claude полезет во все три табло наугад.' },
            ],
            hints: ['Хороший ответ говорит, где поломка и как она выглядит.', 'Назови табло и симптом.'],
            output: [
              tool('Read(src/board-booth.ts)'),
              result('Read 52 lines'),
              say('Нашёл: табло берёт объявления из кэша и не обновляет его'),
              say('после полуночи.'),
            ],
            explain: 'Чем точнее просьба, тем меньше догадок: где сломано и как это выглядит. Пример из жизни: «почини баг» хуже, чем «пустой экран после ввода пароля».',
          },
          {
            id: 's3',
            kind: 'command',
            prompt: 'claude',
            task: 'Прежде чем продолжить, загляни в справку: какие команды знает Claude Code?',
            accept: ['/help'],
            example: '/help',
            hints: ['Справка — это слэш-команда.', 'По-английски «помощь» — help.'],
            wrong: [
              { match: 'help', reply: 'Почти! Нужен слэш в начале.' },
              { match: '/?(?:помощь|справка|помоги)', reply: 'Команды пишутся по-английски и со слэшем. «Помощь» — help.' },
              { match: '\\?', reply: '? покажет горячие клавиши. А справку по командам даёт слэш-команда.' },
              { match: '/(?:commands|list|man|info)', reply: 'Такой команды нет. Справка называется по-английски «помощь».' },
            ],
            output: [
              dim('Справка: команды Claude Code и подсказки по клавишам.'),
              code('/init   /help   /clear   /exit   …'),
            ],
            explain: '/help — справка о командах Claude Code. Загляни в неё, когда не помнишь, какая команда нужна.',
          },
          {
            id: 's4',
            kind: 'key',
            task: 'Теперь открой панель горячих клавиш. Строка ввода пустая — хватит одной клавиши.',
            keys: ['?'],
            example: '?',
            hints: ['Подсказка написана справа под строкой ввода: «… for shortcuts».', 'Это знак вопроса.'],
            output: [
              box('! — команда оболочки      / — команды'),
              box('@ — упомянуть файл        shift+tab — режимы'),
              box('\\ + Enter — новая строка  esc — прервать'),
            ],
            explain: '? на пустой строке открывает и закрывает панель горячих клавиш. Удобно, когда забыл сочетание.',
          },
          {
            id: 's5',
            kind: 'command',
            prompt: 'claude',
            task: 'Просьба выйдет длинной. Напиши первую строку и перенеси ввод на новую строку так, чтобы Enter ничего не отправил.',
            accept: ['.{4,} ?\\\\'],
            example: 'исправь обновление кэша табло \\',
            hints: ['Есть способ, который работает в любом терминале.', 'Поставь в конце строки обратный слэш и нажми Enter.', 'Например: исправь обновление кэша табло \\'],
            wrong: [
              { match: '.{4,} ?/', reply: 'Это прямой слэш. Нужен обратный: \\' },
              { match: `${WORDS}.{4,}[^\\\\]`, reply: 'Так Enter отправит просьбу сразу. Поставь в конце строки обратный слэш \\' },
            ],
            output: [dim('Перенос строки: просьба ещё не отправлена.')],
            explain: '\\ и Enter переносят строку в любом терминале. В некоторых терминалах (Windows Terminal, iTerm2) работает и Shift+Enter.',
          },
          {
            id: 's6',
            kind: 'command',
            prompt: 'claude',
            task: 'Допиши вторую строку: попроси добавить тест на смену суток. И отправь просьбу.',
            accept: [`${WORDS}(?=.*(?:тест|test|сут|полноч|midnight|день|day)).{6,}`],
            example: 'и добавь тест на смену суток',
            hints: ['Теперь Enter без слэша — он отправит обе строки.', 'Например: «и добавь тест на смену суток».'],
            wrong: [
              { match: '.* ?\\\\', reply: 'Ещё один перенос не нужен. Допиши вторую строку без слэша и нажми Enter.' },
              { match: `${WORDS}(?!.*(?:тест|test|сут|полноч|midnight|день|day)).{6,}`, reply: 'Во второй строке попроси тест на смену суток.' },
            ],
            output: [
              tool('Edit(src/board-booth.ts)'),
              add('scheduleAt("00:00", () => cache.refresh());'),
              tool('Write(tests/midnight.test.ts)'),
              result('Wrote 14 lines'),
              tool('Bash(npm test)'),
              result('9 passed'),
              say('Кэш обновляется в полночь, тест на смену суток проходит.'),
              dim('Табло мигает и пишет: «ПЕРЕУЛОК ЗАГРУЗКИ · СВЕТ ВКЛЮЧЁН».'),
            ],
            explain: 'Задача, место и проверка в одной просьбе — и Claude справился с первого раза. Длинные просьбы удобно писать в несколько строк.',
          },
        ],
      },
    },
  ],

  npcs: [
    {
      id: 'ping',
      name: 'Пинг',
      model: 'npc_drone',
      tint: '#19e3ff',
      dialogs: [
        {
          when: { gateOpen: true },
          lines: [
            { text: 'Ворота открыты! Слышишь, как гудит переулок? Это ты его разбудил.', mood: 'happy' },
            { text: 'Запомни главное: Claude понимает обычные слова. А что ему можно делать, решаешь ты.', mood: 'neutral' },
            { text: 'Дальше Рынок Памяти. Там живёт Дед Кэш: он забывает всё, что не записано. Передай ему пинг от Пинга!', mood: 'happy' },
            { text: 'Бип-бип! Пинг от Пинга!', speaker: 'ХАРНИ', mood: 'excited' },
          ],
        },
        {
          when: { done: ['t2'], notDone: ['t3'] },
          lines: [
            { text: 'Вывеска горит! Мама Сокет теперь кормит лапшой весь переулок.', mood: 'happy' },
            { text: 'Остались ворота. Их привод старые операторы держали в ручном режиме.', mood: 'neutral' },
            { text: 'Там Claude спрашивает перед каждой командой. Это не помеха — это руль.', mood: 'thinking' },
            { text: 'Читай, что он хочет запустить. Безопасное — разреши. Опасное — отмени.', mood: 'neutral' },
          ],
        },
        {
          when: { done: ['t1'], notDone: ['t2'] },
          lines: [
            { text: 'Свет! Настоящий свет! Видишь? Просто скажи ему, что нужно.', mood: 'excited' },
            { text: 'Но есть беда: каждая новая сессия Claude начинается с чистого листа. Вчерашнего он не помнит.', mood: 'worried' },
            { text: 'Поэтому ему оставляют памятку — файл CLAUDE.md. Он читает её каждый раз, как просыпается.', mood: 'neutral' },
            { text: 'У Мамы Сокет опять мигает вывеска. Начни там с памятки.', mood: 'thinking' },
          ],
        },
        {
          when: { notDone: ['t1'] },
          lines: [
            { text: 'Пинг! Пинг! Эй, гусеничный, ты живой? Огонёк мигает — значит, живой!', mood: 'excited' },
            { text: 'Бип?.. Где я?', speaker: 'ХАРНИ', mood: 'thinking' },
            { text: 'В Переулке Загрузки. Тебя выкинули в хлам, а я разбудил. Я Пинг, курьер: ношу сообщения, когда сеть лежит.', mood: 'neutral' },
            { text: 'Город гаснет. Но в старых терминалах живёт Claude Code: он читает и чинит код. Нужен только оператор.', mood: 'worried' },
            { text: 'Команды зубрить не надо. Подъедь к терминалу фонарей и просто скажи, что нужно. Он поймёт.', mood: 'happy' },
          ],
        },
        {
          lines: [
            { text: 'Пинг! Я тут, кружу над переулком.', mood: 'happy' },
            { text: 'Не знаешь, что сказать Claude? Скажи как есть: что сломано и где.', mood: 'neutral' },
            { text: 'А если он просит разрешения — сначала прочти, что он хочет сделать.', mood: 'thinking' },
          ],
        },
      ],
    },
    {
      id: 'socket',
      name: 'Мама Сокет',
      model: 'npc_round',
      tint: '#ff2e88',
      dialogs: [
        {
          when: { done: ['t2'] },
          lines: [
            { text: 'Горит! Ровненько, как в молодости. Восемьдесят процентов — и ни трубкой больше!', mood: 'happy' },
            { text: 'Теперь любой ремонтник откроет памятку и всё поймёт. Хорошо, когда правила записаны.', mood: 'neutral' },
            { text: 'Заезжай на лапшу, гусеничный. Масло для гусениц — за счёт заведения.', mood: 'happy' },
          ],
        },
        {
          when: { notDone: ['t2'] },
          lines: [
            { text: 'Ой, новенький! Я Мама Сокет, лапшичная моя. Подключайся, у меня всегда горячо.', mood: 'excited' },
            { text: 'Вывеска мигает, и все думают, что я закрыта. Её чинили сто раз — и сто раз всё забывали.', mood: 'worried' },
            { text: 'Каждый ремонтник начинает с нуля и уходит, ничего не записав. Хоть бы памятку оставили!', mood: 'worried' },
            { text: 'И одно правило помни: яркость не выше восьмидесяти. На полной трубки сгорают.', mood: 'thinking' },
          ],
        },
        {
          lines: [
            { text: 'Лапша с маслом, лапша с искрой, лапша с двойным напряжением!', mood: 'happy' },
            { text: 'Шучу. Просто лапша. Но вкусная.', mood: 'happy' },
            { text: 'Заезжай, когда проголодаешься.', mood: 'neutral' },
          ],
        },
      ],
    },
  ],

  chips: [
    {
      id: 'c1',
      title: 'Какая версия?',
      text: 'claude --version печатает версию, например 2.1.281 (Claude Code). Если оболочка пишет «not found», папка установки не прописана в PATH.',
      unlocks: ['cli-version'],
    },
    {
      id: 'c2',
      title: 'Меню команд',
      text: 'Набери / — откроется меню всех команд и скиллов. Печатай дальше, чтобы сузить список, а Tab допишет команду.',
      unlocks: ['concept-slash-menu'],
    },
    {
      id: 'c3',
      title: 'Очередь сообщений',
      text: 'Написал и нажал Enter, пока Claude работает? Сообщение встанет в очередь, а не прервёт его. Ждущие сообщения видны серым.',
      unlocks: ['concept-message-queue'],
    },
    {
      id: 'c4',
      title: 'Выход клавишами',
      text: 'Ctrl+C прерывает работу. Когда Claude ничего не делает, первое нажатие очищает ввод, второе закрывает Claude Code. Ctrl+D дважды подряд — тоже выход.',
      unlocks: ['key-ctrl-c'],
    },
  ],

  zones: [
    { id: 'z1', text: 'Системы… запущены. Где это я? Кругом хлам, и темно.' },
    { id: 'z2', text: 'Пахнет лапшой! А вывеска мигает: ЛАП… ША… ЛАП…', when: { notDone: ['t2'] } },
    { id: 'z3', text: 'Ворота переулка. Заклинило намертво — нужен привод.', when: { gateOpen: false } },
  ],
};
