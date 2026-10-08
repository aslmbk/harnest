// Level 2 — «Рынок Памяти»: context and memory (@ mentions, ! shell mode, /context, /compact, /clear,
// CLAUDE.md layers, /memory, auto memory; bonus: claude -c, claude -r, /resume, /rename).
// Facts: docs/claude-code-reference.md §2. Tool rows and screen layouts are flavour (UNVERIFIED there);
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
const ok = (text: string): TermLine => ({ text, style: 'ok' });

// Answer pattern parts (anchored, case-insensitive, see match.ts).
/** A prompt in words: not a slash command, not shell mode, not the removed # shortcut. */
const WORDS = '(?![/!#])';
const YES = '(?:да|ага|ок|окей|yes|ok|okay|давай|угу)[.!]*';
const FIX = '(?:исправ|почин|поправ|измен|поменя|сдела|верн|fix|change|repair)';
const PRICES = '@(?:\\./)?src/prices\\.ts';
const RULES_DIR = '@(?:\\./)?src/rules/?(?![\\w./-])';
const LANTERN = '(?:фонар|lantern|lamp|light|свет|освещ|таймер|timer)';
/** The file name CLAUDE.md, also typed as "claude md". */
const CLAUDE_MD = 'claude[ .]?md';

export const meta: LevelMeta = {
  title: 'Рынок Памяти',
  subtitle: 'Контекст и память Claude',
  topics: [
    'Упоминания @файл и @папка, режим оболочки !',
    'Контекст: /context, /compact, /clear',
    'Памятки CLAUDE.md: личная, проектная, локальная; /memory и автопамять',
    'Бонус: claude -c, claude -r, /resume, /rename',
  ],
  intro: [
    'Рынок Памяти шумит под фонариками: здесь меняют платы, батарейки и воспоминания. Только сами торговцы всё забывают — цены на табло скачут, фонари гаснут, часы стоят.',
    'Claude тоже помнит не всё. Его рабочая память — контекст — однажды заполняется. Здесь ты научишься класть в неё нужное, освобождать место и записывать то, что должно пережить любую сессию.',
    'Цель: починить табло цен, фонари рынка и часы над воротами.',
  ],
  outro: [
    'Рынок помнит всё, что нужно. Ты показывал Claude файлы через @, запускал команды через !, следил за контекстом, сжимал и очищал его и раскладывал правила по памяткам.',
    'Как говорит Дед Кэш: голова — для работы, записи — для памяти. Впереди Депо Планов, где сначала думают, а потом делают.',
  ],
};

export const lessons: LevelLessons = {
  terminals: [
    // ───────────── t1 · @ mentions and ! shell mode ─────────────
    {
      id: 't1',
      title: 'Табло цен',
      required: true,
      challenge: {
        title: 'Покажи и проверь',
        brief: 'Табло цен сошло с ума: болт стоит сто двадцать пять монет. Торговцы ругаются, покупатели разворачиваются.',
        cwd: '~/city/price-board',
        unlocks: ['concept-at-mention', 'concept-at-folder', 'concept-shell-mode'],
        steps: [
          {
            id: 's1',
            kind: 'command',
            prompt: 'shell',
            task: 'Ты у кода табло. Запусти Claude Code.',
            accept: ['claude'],
            example: 'claude',
            hints: ['Как в Переулке Загрузки.', 'Одно слово — имя помощника.'],
            wrong: [
              { match: 'claude[ _-]?code(?: .*)?', reply: 'Почти! Команда короче — одно слово.' },
              { match: `claude (?:-p|--print)(?: .*)?`, reply: '-p ответит один раз и выйдет. Для ремонта нужна живая сессия.' },
              { match: '[@!].*', reply: 'Упоминания и ! работают внутри Claude Code. Сначала запусти его.' },
            ],
            explain: 'Новая сессия — новый, пустой контекст. Всё, что Claude узнает дальше, ляжет в него.',
          },
          {
            id: 's2',
            kind: 'command',
            prompt: 'claude',
            task: 'Покажи Claude файл src/prices.ts упоминанием и спроси, откуда на табло такие цены.',
            accept: [`(?!${PRICES}$)(?=.*${PRICES}).{16,}`],
            example: 'откуда такие цены? @src/prices.ts',
            hints: ['Упоминание файла начинается с особого знака.', 'Знак @, а сразу за ним путь к файлу.', 'Например: «откуда такие цены? @src/prices.ts».'],
            wrong: [
              { match: '(?!.*@)(?=.*src/prices\\.ts).*', reply: 'Почти! Поставь @ перед путём — тогда файл целиком попадёт в разговор.' },
              { match: '(?=.*@(?:\\./)?prices\\.ts).*', reply: 'Укажи путь от корня проекта: файл лежит в папке src.' },
              { match: `${PRICES}`, reply: 'Файл есть, а вопроса нет. Допиши, что хочешь узнать.' },
              { match: '(?!.*@).+', reply: 'Покажи Claude файл упоминанием: знак @ и путь src/prices.ts.' },
            ],
            output: [
              dim('src/prices.ts попал в разговор целиком.'),
              say('Сам prices.ts только складывает цены из базы и прогоняет их'),
              say('через правила из папки src/rules. Ошибка, видимо, там.'),
            ],
            explain: '@файл кладёт в разговор весь файл: Claude не нужно его искать. Набери @, и Claude подскажет пути.',
          },
          {
            id: 's3',
            kind: 'command',
            prompt: 'claude',
            task: 'Упомяни саму папку src/rules и спроси, какое из правил портит цены.',
            accept: [`(?!${RULES_DIR}$)(?=.*${RULES_DIR}).{12,}`],
            example: 'какое правило из @src/rules портит цены?',
            hints: ['Упоминать можно не только файлы, но и папки.', 'Тот же знак @ и путь к папке: @src/rules'],
            wrong: [
              { match: '(?=.*@(?:\\./)?src/rules/[\\w.-]+).*', reply: 'Это файл внутри папки. Упомяни саму папку: @src/rules.' },
              { match: '(?!.*@)(?=.*src/rules).*', reply: 'Почти! Поставь @ перед путём к папке.' },
              { match: `${RULES_DIR}`, reply: 'Допиши вопрос: какое правило портит цены?' },
            ],
            output: [
              dim('@src/rules — список файлов папки:'),
              code('currency.ts   markup.ts   rounding.ts   tax.ts'),
              tool('Read(src/rules/currency.ts)'),
              result('Read 12 lines'),
              say('Похоже, currency.ts: курс задан как 10 вместо 1.0.'),
            ],
            explain: '@папка даёт Claude список её файлов, а не содержимое. Дальше он сам читает то, что нужно.',
          },
          {
            id: 's4',
            kind: 'command',
            prompt: 'claude',
            task: 'Проверь догадку: запусти тесты npm test сам, прямо из строки Claude, не прося его.',
            accept: ['! ?npm (?:run )?test(?: .*)?'],
            example: '! npm test',
            hints: ['В строке Claude есть режим оболочки.', 'Строка, которая начинается с «!», сразу выполняется как команда.', 'Например: ! npm test'],
            wrong: [
              { match: 'npm (?:run )?test(?: .*)?', reply: 'Так это уйдёт Claude как просьба. Чтобы запустить самому, начни строку с «!».' },
              { match: `${WORDS}(?=.*(?:тест|test)).*`, reply: 'Claude справился бы, но задача — запустить самому. Начни строку с «!».' },
              { match: '! ?(?:test|tests|тест)', reply: 'Команда целиком: npm test.' },
              { match: '!(?! ?npm (?:run )?test) ?\\S.*', reply: 'Режим верный! А команда нужна другая: npm test.' },
            ],
            output: [
              code('FAIL tests/currency.test.ts'),
              code('  expected 12.50, received 125.00'),
              say('Тест подтверждает: курс 10 умножает каждую цену в десять раз.'),
              say('Исправить src/rules/currency.ts?'),
            ],
            explain: '«!» запускает команду сразу и кладёт её вывод в разговор, а Claude сам отвечает на него. Выход из режима — Esc или Backspace на пустой строке.',
          },
          {
            id: 's5',
            kind: 'command',
            prompt: 'claude',
            task: 'Догадка подтвердилась. Попроси Claude исправить курс в src/rules/currency.ts.',
            // Claude has just asked «Исправить src/rules/currency.ts?», so a plain «да» is a good answer too.
            accept: [`${WORDS}(?=.*(?:${FIX}|курс|currency|rate)).{4,}`, YES],
            example: 'да, исправь курс в @src/rules/currency.ts',
            hints: ['Просто попроси исправить — можно упомянуть файл.', 'Например: «исправь курс в @src/rules/currency.ts».'],
            wrong: [
              { match: '! ?npm (?:run )?test.*', reply: 'Тесты ты уже видел. Теперь попроси Claude исправить курс.' },
              { match: '/.*', reply: 'Команда не нужна — попроси Claude словами.' },
              { match: `${WORDS}(?!.*(?:${FIX}|курс|currency|rate)).{4,}`, reply: 'Попроси прямо: исправь курс в src/rules/currency.ts.' },
            ],
            output: [
              tool('Edit(src/rules/currency.ts)'),
              del('export const RATE = 10;'),
              add('export const RATE = 1.0;'),
              tool('Bash(npm test)'),
              result('14 passed'),
              say('Курс исправлен, тесты зелёные.'),
              dim('Табло перещёлкивает строки: БОЛТ — 12.50. Рынок выдыхает.'),
            ],
            explain: 'Упоминание даёт контекст, ! даёт факты, а дальше Claude чинит уже наверняка. Так работают без лишних кругов.',
          },
        ],
      },
    },

    // ───────────── t2 · the context window: /context, /compact, /clear ─────────────
    {
      id: 't2',
      title: 'Фонари рынка',
      required: true,
      requires: ['t1'],
      challenge: {
        title: 'Тесная голова',
        brief:
          'Бумажные фонарики над рядами гаснут на закате. Их ремонт начали ещё утром, и с тех пор сессию никто не закрывал.',
        cwd: '~/city/lanterns',
        unlocks: ['concept-context-window', 'slash-context', 'slash-compact', 'slash-clear'],
        steps: [
          {
            id: 's1',
            kind: 'command',
            prompt: 'claude',
            task: 'Claude отвечает всё медленнее и путает детали. Посмотри, чем занят его контекст.',
            accept: ['/context(?: all)?'],
            example: '/context',
            hints: ['Для этого есть слэш-команда.', 'Она называется как сама рабочая память — context.'],
            wrong: [
              { match: 'context', reply: 'Почти! Нужен слэш в начале.' },
              { match: '/memory(?: .*)?', reply: '/memory — про памятки CLAUDE.md. Заполненность контекста показывает другая команда.' },
              { match: '/(?:usage|cost|status)(?: .*)?', reply: 'Это про сессию и расходы. Карту контекста рисует другая команда.' },
              { match: '/(?:clear|compact)(?: .*)?', reply: 'Не спеши: сначала посмотри, что занимает место.' },
            ],
            output: [
              dim('Цветная сетка: каждая клетка — кусочек контекста.'),
              box('Messages      148k'),
              box('MCP tools       6k'),
              box('Free space     30k'),
              say('Почти всё занял разговор: утренний ремонт фонарей и долгий'),
              say('спор Свапа о ценах на батарейки.'),
            ],
            explain: 'Контекст — рабочая память Claude: весь разговор, прочитанные файлы, вывод команд. Чем он теснее, тем хуже Claude держит важное.',
          },
          {
            id: 's2',
            kind: 'choice',
            style: 'quiz',
            task: 'Ремонт фонарей не закончен, а места почти не осталось. Что сделать?',
            question: 'Как освободить место, не потеряв ремонт?',
            options: [
              { label: 'Сжать разговор в сводку', correct: true, reply: 'Сводка сохранит главное про фонари, а место освободится.' },
              { label: 'Очистить контекст и начать заново', reply: 'Тогда пропадёт всё, что вы с Claude уже нашли про фонари.' },
              {
                label: 'Ничего: Claude справится сам',
                reply: 'Автосжатие сработает только у самого края — и сожмёт как придётся. Лучше решить самому, что сохранить.',
              },
            ],
            hints: ['Нужное надо сохранить, а лишнее — убрать.', 'Сводка вместо длинного разговора.'],
            explain: 'Сжатие — когда работа ещё идёт, но место кончается. Очистка — когда начинаешь что-то совсем другое.',
          },
          {
            id: 's3',
            kind: 'command',
            prompt: 'claude',
            task: 'Сожми разговор так, чтобы в сводке точно остался ремонт фонарей.',
            accept: [`/compact (?=.*${LANTERN}).{4,}`],
            example: '/compact focus on the lantern timer fix',
            hints: [
              'Команда сжатия — по-английски «уплотнить».',
              'После /compact можно сказать, что сохранить: focus on …',
              'Например: /compact focus on the lantern timer fix',
            ],
            wrong: [
              { match: '/compact', reply: 'Сработает, но сожмёт всё подряд. Допиши, что сохранить: ремонт фонарей.' },
              { match: `/compact (?!.*${LANTERN}).+`, reply: 'Сосредоточь сводку на фонарях — для них она и нужна.' },
              { match: '/clear(?: .*)?', reply: 'Тогда пропадёт всё найденное про фонари. Нужно сжатие, а не очистка.' },
            ],
            output: [dim('Разговор сжат в сводку: таймер фонарей, найденная ошибка, план.'), dim('Спор о батарейках в сводку не попал.')],
            explain:
              '/compact заменяет разговор сводкой, а слова после команды решают, что в ней останется. Пример из документации: /compact focus on the auth bug fix.',
          },
          {
            id: 's4',
            kind: 'command',
            prompt: 'claude',
            task: 'Доведи ремонт: попроси Claude исправить таймер, чтобы фонари зажигались на закате.',
            accept: [`${WORDS}(?=.*(?:${LANTERN}|${FIX}|закат|sunset)).{8,}`],
            example: 'исправь таймер, чтобы фонари зажигались на закате',
            hints: ['Сводка у Claude есть — просто попроси.', 'Например: «исправь таймер, чтобы фонари зажигались на закате».'],
            wrong: [
              { match: '/compact(?: .*)?', reply: 'Уже сжато. Теперь к делу: попроси исправить таймер.' },
              { match: '/clear(?: .*)?', reply: 'Рано: ремонт ещё не закончен.' },
              { match: `${YES}`, reply: 'Скажи, что сделать: исправить таймер фонарей.' },
            ],
            output: [
              tool('Read(src/timer.ts)'),
              result('Read 40 lines'),
              tool('Edit(src/timer.ts)'),
              del('const SUNSET = "18:00";'),
              add('const SUNSET = sunsetFor(today());'),
              tool('Bash(npm test)'),
              result('9 passed'),
              say('Таймер считает закат по календарю, а не по одному часу на весь год.'),
              dim('Над рядами один за другим загораются бумажные фонарики.'),
            ],
            explain: 'После сжатия Claude помнит главное и спокойно доводит работу. Объяснять заново ничего не пришлось.',
          },
          {
            id: 's5',
            kind: 'command',
            prompt: 'claude',
            task: 'Фонари горят. Свап просит разобраться с грузовым лифтом — совсем другая задача. Начни её с чистого контекста.',
            accept: ['/clear(?: .+)?'],
            example: '/clear',
            hints: ['Нужен чистый лист — одной слэш-командой.', 'По-английски «очистить» — clear.'],
            wrong: [
              { match: '/compact(?: .*)?', reply: 'Сводка про фонари новой задаче только помешает. Нужен чистый лист.' },
              { match: '/exit|/quit', reply: 'Выходить не нужно: чистый лист даёт одна команда прямо в сессии.' },
              { match: '/context(?: .*)?', reply: 'Карту ты уже видел. Теперь нужен чистый лист.' },
            ],
            output: [dim('Контекст пуст. Разговор про фонари остался в /resume.')],
            explain: '/clear — между несвязанными задачами: старые детали только сбивают Claude. Прошлый разговор не пропадает — его вернёт /resume.',
          },
        ],
      },
    },

    // ───────────── t3 · CLAUDE.md layers, /memory, auto memory ─────────────
    {
      id: 't3',
      title: 'Часы рынка',
      required: true,
      requires: ['t2'],
      challenge: {
        title: 'Записанное остаётся',
        brief: 'Часы над воротами рынка стоят. Их чинили многие — и каждый заново узнавал одни и те же правила.',
        cwd: '~/city/market-clock',
        unlocks: ['file-claude-md-layers', 'file-claude-local-md', 'concept-auto-memory', 'slash-memory'],
        steps: [
          {
            id: 's1',
            kind: 'choice',
            style: 'quiz',
            task: 'Правило «часы идут по рыночному времени, UTC+3» нужно всем, кто их чинит. Куда его записать?',
            question: 'Какая памятка подходит?',
            options: [
              { label: './CLAUDE.md — памятка проекта, в git', correct: true, reply: 'Её получат все, кто откроет репозиторий.' },
              { label: '~/.claude/CLAUDE.md — твоя личная', reply: 'Личная памятка есть только у тебя. А правило нужно всем.' },
              { label: './CLAUDE.local.md — твоя, в этом проекте', reply: 'Локальная памятка не попадает в git — остальные её не увидят.' },
            ],
            hints: ['Правило нужно всей бригаде.', 'Общее для команды едет вместе с репозиторием — через git.'],
            explain: 'Памятки складываются, а не заменяют друг друга: личная, проектная и локальная загружаются вместе.',
          },
          {
            id: 's2',
            kind: 'command',
            prompt: 'claude',
            task: 'Попроси Claude записать в CLAUDE.md проекта правило: часы идут по UTC+3.',
            accept: [`${WORDS}(?=.*(?:${CLAUDE_MD}|памятк))(?=.*(?:utc|\\+3|врем|time)).{12,}`],
            example: 'добавь в CLAUDE.md правило: часы идут по UTC+3',
            hints: ['Как в Переулке Загрузки: просто попроси словами.', 'Назови файл CLAUDE.md и само правило про UTC+3.'],
            wrong: [
              { match: '#.*', reply: 'Быстрой записи через # больше нет. Просто попроси: «добавь в CLAUDE.md…».' },
              {
                match: `${WORDS}(?!.*(?:${CLAUDE_MD}|памятк))(?=.*(?:utc|\\+3|врем|time)).*`,
                reply: 'Claude запомнит это до конца разговора. Чтобы правило осталось, попроси записать его в CLAUDE.md.',
              },
              { match: `${WORDS}(?=.*(?:${CLAUDE_MD}|памятк))(?!.*(?:utc|\\+3|врем|time)).*`, reply: 'Какое правило записать? Часы идут по UTC+3.' },
              { match: '/memory(?: .*)?', reply: 'Через /memory можно и руками. Но быстрее попросить Claude словами.' },
            ],
            output: [tool('Edit(CLAUDE.md)'), add('- Часы идут по рыночному времени: UTC+3.'), say('Записал в CLAUDE.md проекта — правило увидит вся бригада.')],
            explain: 'Проектную памятку кладут в ./CLAUDE.md или в ./.claude/CLAUDE.md. Она едет в git вместе с кодом.',
          },
          {
            id: 's3',
            kind: 'choice',
            style: 'quiz',
            task: 'А ты любишь короткие ответы — во всех проектах, не только здесь. Куда записать эту привычку?',
            question: 'Какая памятка?',
            options: [
              { label: '~/.claude/CLAUDE.md — личная, для всех проектов', correct: true, reply: 'Да: эта памятка с тобой в любом проекте.' },
              { label: './CLAUDE.md — памятка проекта', reply: 'Тогда короткие ответы получит вся бригада. А привычка — твоя.' },
              { label: './CLAUDE.local.md — твоя, но только здесь', reply: 'Только в этом проекте. А нужно во всех.' },
            ],
            hints: ['Привычка твоя и нужна везде.', 'Личные настройки Claude живут в твоей домашней папке, в ~/.claude/.'],
            explain: 'CLAUDE.local.md — для личных заметок об одном проекте, его добавляют в .gitignore. А ~/.claude/CLAUDE.md действует везде.',
          },
          {
            id: 's4',
            kind: 'command',
            prompt: 'claude',
            task: 'Скажи Claude запомнить: часы отстают на минуту в неделю, а подводят их по воскресеньям.',
            accept: [`${WORDS}(?=.*(?:запомни|помни|remember|сохрани)).{12,}`],
            example: 'запомни: часы отстают на минуту в неделю, подводим по воскресеньям',
            hints: ['Просто попроси Claude это запомнить.', 'Например: «запомни: часы отстают на минуту в неделю, подводим по воскресеньям».'],
            wrong: [
              { match: '#.*', reply: '# больше не сохраняет в память. Просто скажи: «запомни…».' },
              {
                match: `${WORDS}(?!.*(?:запомни|помни|remember|сохрани)).*(?:отста|минут|воскрес|week|sunday).*`,
                reply: 'Скажи Claude именно запомнить: «запомни…».',
              },
            ],
            output: [say('Запомнил оба факта о часах.'), ok('Saved 2 memories')],
            explain:
              '«Запомни…» уходит не в CLAUDE.md, а в автопамять: Claude ведёт свои заметки в ~/.claude/projects/<проект>/memory/MEMORY.md.',
          },
          {
            id: 's5',
            kind: 'command',
            prompt: 'claude',
            task: 'Открой список памяток: посмотри, какие загружены, и проверь, включена ли автопамять.',
            accept: ['/memory'],
            example: '/memory',
            hints: ['Для памяток есть своя слэш-команда.', 'По-английски «память» — memory.'],
            wrong: [
              { match: 'memory', reply: 'Почти! Нужен слэш в начале.' },
              { match: '/init(?: .*)?', reply: '/init пишет памятку по коду. А открыть существующие — другая команда.' },
              { match: '/context(?: .*)?', reply: '/context — про заполненность. Памятки открывает другая команда.' },
            ],
            output: [box('~/.claude/CLAUDE.md          личная'), box('./CLAUDE.md                  проект'), box('Автопамять: включена · 2 заметки')],
            explain: '/memory открывает памятки CLAUDE.md для правки, включает и выключает автопамять и показывает её заметки.',
          },
          {
            id: 's6',
            kind: 'command',
            prompt: 'claude',
            task: 'Теперь попроси Claude подвести и запустить часы.',
            accept: [`${WORDS}(?=.*(?:час|clock|подвед|запуст|${FIX})).{6,}`],
            example: 'подведи и запусти часы',
            hints: ['Обычная просьба — памятки сработают сами.', 'Например: «подведи и запусти часы».'],
            wrong: [
              { match: '/memory(?: .*)?', reply: 'Памятки на месте. Теперь просто попроси подвести часы.' },
              { match: `${YES}`, reply: 'Скажи, что сделать: подвести и запустить часы.' },
            ],
            output: [
              tool('Read(src/clock.ts)'),
              result('Read 57 lines'),
              tool('Edit(src/clock.ts)'),
              del('const ZONE = "UTC";'),
              add('const ZONE = "UTC+3"; // CLAUDE.md'),
              add('const DRIFT_PER_WEEK_S = 60;'),
              say('Время рыночное — по правилу из CLAUDE.md. Поправка на минуту'),
              say('в неделю — из автопамяти.'),
              dim('Над воротами рынка вздрагивают стрелки. Часы бьют семь.'),
            ],
            explain: 'Правило из CLAUDE.md и заметка из автопамяти пригодились сами, без напоминаний. Записанное переживает любую сессию.',
          },
        ],
      },
    },

    // ───────────── t4 · bonus: sessions (claude -c, /rename, claude -r, /resume) ─────────────
    {
      id: 't4',
      title: 'Камера хранения',
      required: false,
      challenge: {
        title: 'Вчерашний разговор',
        brief: 'Сортировщик камеры хранения кидает ящики не на те полки. Вчера его ремонт начали — и не закончили.',
        cwd: '~/city/lost-and-found',
        unlocks: ['cli-continue', 'slash-rename', 'cli-resume', 'slash-resume'],
        steps: [
          {
            id: 's1',
            kind: 'command',
            prompt: 'shell',
            task: 'Продолжи вчерашний разговор в этой папке — с того места, где остановились.',
            accept: ['claude (?:-c|--continue)'],
            example: 'claude -c',
            hints: ['У claude есть флаг «продолжить».', 'По-английски continue, короткая форма — одна буква.', 'Шаблон: claude -<первая буква continue>'],
            wrong: [
              { match: 'claude', reply: 'Так начнётся новый разговор с чистого листа. Нужен флаг «продолжить».' },
              { match: 'claude (?:-r|--resume)(?: .*)?', reply: '-r откроет выбор сессий. А последний разговор продолжает флаг попроще.' },
              { match: '/(?:resume|continue).*', reply: 'Это команда внутри сессии. А тут оболочка — нужен флаг для claude.' },
              { match: 'claude (?:continue|продолжи|продолжить)', reply: 'Флаги пишут через дефис: короткий — одна буква, длинный — --continue.' },
            ],
            output: [dim('Восстановлен последний разговор в этой папке.'), say('Вчера мы нашли: сортировщик путает полки 7 и 9. Продолжим?')],
            explain: 'claude -c открывает последний разговор в этой папке — со всем его контекстом и режимом разрешений.',
          },
          {
            id: 's2',
            kind: 'command',
            prompt: 'claude',
            task: 'Дай этой сессии имя sorter-fix, чтобы потом найти её среди других.',
            accept: [`/rename ["']?sorter-fix["']?`],
            example: '/rename sorter-fix',
            hints: ['Имя меняет слэш-команда — «переименовать».', 'После /rename через пробел — имя.', 'Шаблон: /rename <имя>'],
            wrong: [
              { match: '/rename', reply: 'Допиши имя после команды: sorter-fix.' },
              { match: `/rename (?!["']?sorter-fix["']?$).+`, reply: 'Назови сессию sorter-fix — так её будет легко найти.' },
              { match: 'claude (?:-n|--name)(?: .*)?', reply: '-n даёт имя при запуске. Внутри сессии — слэш-команда.' },
              { match: '/(?:name|title)(?: .*)?', reply: 'Такой команды нет. Нужна «переименовать» — по-английски.' },
            ],
            output: [dim('Сессия теперь называется sorter-fix.')],
            explain: 'Имя видно в строке ввода, в списке /resume и в заголовке терминала. Сразу при запуске имя даёт флаг -n: claude -n sorter-fix.',
          },
          {
            id: 's3',
            kind: 'command',
            prompt: 'claude',
            task: 'Да, продолжим: попроси Claude поменять местами полки 7 и 9 в правилах сортировщика.',
            accept: [`${WORDS}(?=.*(?:7|9|полк|shelf|сорт|sort|${FIX})).{6,}`],
            example: 'поменяй местами полки 7 и 9',
            hints: ['Контекст вчерашнего разговора на месте — просто попроси.', 'Например: «поменяй местами полки 7 и 9».'],
            wrong: [
              { match: '/rename(?: .*)?', reply: 'Имя уже есть. Теперь к делу: попроси поменять полки.' },
              { match: `${YES}`, reply: 'Скажи, что сделать: поменять местами полки 7 и 9.' },
            ],
            output: [
              tool('Edit(config/shelves.json)'),
              del('"fragile": 7,'),
              del('"heavy": 9,'),
              add('"fragile": 9,'),
              add('"heavy": 7,'),
              tool('Bash(npm test)'),
              result('11 passed'),
              say('Готово: хрупкое едет на девятую полку, тяжёлое — на седьмую.'),
            ],
            explain: 'Вчерашний контекст пригодился: Claude не пришлось заново искать ошибку.',
          },
          {
            id: 's4',
            kind: 'command',
            prompt: 'claude',
            task: 'Смена окончена. Выйди из Claude Code.',
            accept: ['/exit', '/quit'],
            example: '/exit',
            hints: ['Как у ворот Переулка Загрузки.', 'Слэш и «выход» по-английски.'],
            wrong: [
              { match: 'exit|quit', reply: 'Почти! Нужен слэш в начале.' },
              { match: '/clear(?: .*)?', reply: 'Очистка не закроет сессию. Нужен выход.' },
            ],
            output: [dim('Сессия sorter-fix сохранена.')],
            explain: 'Выход не стирает разговор: его можно продолжить или найти по имени.',
          },
          {
            id: 's5',
            kind: 'command',
            prompt: 'shell',
            task: 'Утро. За ночь Свап открыл тут свои сессии, так что последняя — не твоя. Вернись именно к sorter-fix.',
            accept: [`claude (?:-r|--resume)[ =]["']?sorter-fix["']?`],
            example: 'claude -r sorter-fix',
            hints: ['-c возьмёт последний разговор, а он теперь чужой.', 'Нужен флаг «возобновить» (resume) и имя сессии.', 'Шаблон: claude -r <имя>'],
            wrong: [
              { match: 'claude (?:-c|--continue)', reply: '-c откроет последний разговор, а последним был ночной разговор Свапа. Найди свой по имени.' },
              { match: 'claude (?:-r|--resume)', reply: 'Откроется список сессий — тоже путь. Но имя ты знаешь: допиши его.' },
              { match: 'claude (?:-n|--name)(?: .*)?', reply: '-n начнёт новую сессию с этим именем. А нужно вернуться к старой.' },
              { match: `claude ["']?sorter-fix["']?`, reply: 'Так «sorter-fix» уйдёт Claude как просьба. Перед именем нужен флаг «возобновить».' },
            ],
            output: [dim('Возобновлена сессия sorter-fix.'), say('С возвращением! Полки 7 и 9 уже исправлены, тесты зелёные.')],
            explain: 'claude -r без имени открывает выбор сессий, а с именем или ID — сразу нужную. Сессии claude -p в этот выбор не попадают.',
          },
          {
            id: 's6',
            kind: 'command',
            prompt: 'claude',
            task: 'Свап просит найти его ночную сессию про погрузчик. Открой выбор сессий, не выходя из Claude.',
            accept: ['/resume(?: .+)?'],
            example: '/resume',
            hints: ['Внутри сессии есть слэш-команда — близнец флага -r.', 'По-английски «возобновить» — resume.'],
            wrong: [
              { match: 'resume', reply: 'Почти! Нужен слэш в начале.' },
              { match: 'claude (?:-r|--resume)(?: .*)?', reply: 'Это для оболочки. Внутри сессии — слэш-команда.' },
              { match: '/(?:sessions|history|list|continue)(?: .*)?', reply: 'Такой команды нет. Нужна «возобновить» — по-английски.' },
            ],
            output: [box('sorter-fix'), box('swap-loader'), box('night-inventory  bg'), dim('Свап находит swap-loader и радостно жужжит.')],
            explain: '/resume внутри сессии — то же, что claude -r снаружи. Сессии, которые работают в фоне, помечены bg.',
          },
        ],
      },
    },
  ],

  npcs: [
    {
      id: 'kesh',
      name: 'Дед Кэш',
      model: 'npc_tall',
      tint: '#ffb866',
      dialogs: [
        {
          when: { gateOpen: true },
          lines: [
            { text: 'Часы идут! А я и забыл, как они бьют. Хорошо, что кто-то записал.', mood: 'happy' },
            { text: 'Запомни, внучок: голова — для работы, записи — для памяти. Не путай.', mood: 'neutral' },
            { text: 'Дальше Депо Планов. Бригадир там Лямбда — строгая, но толковая. Скажи, что ты от Деда Кэша.', mood: 'happy' },
            { text: 'А я… зачем я сюда шёл? А, вот, на ладони: «проводить ХАРНИ». Провожаю!', mood: 'happy' },
          ],
        },
        {
          when: { done: ['t2'], notDone: ['t3'] },
          lines: [
            { text: 'Фонари горят! Ты сжал разговор и не потерял главное. Ловко.', mood: 'happy' },
            { text: 'Но сжатая голова — всё равно голова. Новая сессия начнётся с пустой.', mood: 'thinking' },
            { text: 'Поэтому правила пишут в памятки. Своя — для своих привычек, общая — для всей бригады.', mood: 'neutral' },
            { text: 'Часы над воротами стоят, и их правила каждый раз узнают заново. Запиши так, чтобы не пришлось.', mood: 'worried' },
          ],
        },
        {
          when: { done: ['t1'], notDone: ['t2'] },
          lines: [
            { text: 'Цены честные! Ты показал Claude ровно то, что нужно, и проверил фактами.', mood: 'happy' },
            { text: 'Но всё, что Claude прочёл, лежит у него в голове. А голова — контекст — не резиновая.', mood: 'thinking' },
            { text: 'Забьёшь её — и он начинает путаться. Как я после третьей батарейки.', mood: 'worried' },
            { text: 'Фонари чинят с самого утра, голова там забита доверху. Посмотри, что в ней, и освободи место.', mood: 'neutral' },
          ],
        },
        {
          when: { notDone: ['t1'] },
          lines: [
            { text: 'А? Кто тут? Ремонтник? Я Дед Кэш. Я тут всё помню… то есть помнил… О чём я?', mood: 'thinking' },
            { text: 'Ага, на ладони записано: «Табло цен сломано». Видишь? Что записано — то не пропадёт.', mood: 'neutral' },
            { text: 'У Claude так же: что у него перед глазами, то он и знает. Покажи ему нужный файл — и он не будет гадать.', mood: 'neutral' },
            { text: 'А догадки проверяй фактами. Запусти тесты сам — и пусть Claude посмотрит на вывод.', mood: 'thinking' },
            { text: 'Бип? А что на другой ладони?', speaker: 'ХАРНИ', mood: 'thinking' },
            { text: '«Не забыть, что на первой ладони что-то записано». Очень важная запись!', mood: 'happy' },
          ],
        },
        {
          lines: [
            { text: 'Контекст — голова, памятка — записка. Голова устаёт, записка — нет.', mood: 'neutral' },
            { text: 'Новая задача — чистая голова. Недоделанная — сжатая сводка.', mood: 'neutral' },
            { text: 'А главное — записывай. Я вот записал, что ты хороший. Где-то тут было…', mood: 'happy' },
          ],
        },
      ],
    },
    {
      id: 'swap',
      name: 'Свап',
      model: 'npc_drone',
      tint: '#ff8a1f',
      dialogs: [
        {
          when: { done: ['t4'] },
          lines: [
            { text: 'Сортировщик работает! Хрупкое — наверх, тяжёлое — вниз. Красота!', mood: 'happy' },
            { text: 'И свою ночную сессию я нашёл — swap-loader. Имена — великая вещь.', mood: 'happy' },
            { text: 'Теперь знаю: вчерашнее — claude -c, нужное по имени — claude -r.', mood: 'neutral' },
          ],
        },
        {
          lines: [
            { text: 'Свап! Грузовой дрон. Таскаю ящики туда-сюда, туда-сюда — потому и Свап.', mood: 'excited' },
            { text: 'В камере хранения беда: сортировщик кидает ящики не на те полки. Вчера начали чинить — и бросили.', mood: 'worried' },
            { text: 'Говорят, разговор с Claude можно продолжить с того же места. Даже назавтра. Поможешь?', mood: 'thinking' },
          ],
        },
      ],
    },
  ],

  chips: [
    {
      id: 'c1',
      title: 'Поиск по истории',
      text: 'Ctrl+R ищет по истории твоих запросов: набери кусочек — и найдётся то, что ты уже писал.',
      unlocks: ['key-ctrl-r'],
    },
    {
      id: 'c2',
      title: 'Вопрос в сторону',
      text: '/btw <вопрос> задаёт вопрос в сторону: Claude ответит, но вопрос не добавится в разговор.',
      unlocks: ['slash-btw'],
    },
    {
      id: 'c3',
      title: 'Памятка из частей',
      text: 'Строка @path/to/file внутри CLAUDE.md подключает другой файл. Путь считается от самой памятки, глубина — до четырёх шагов.',
      unlocks: ['concept-claude-md-imports'],
    },
    {
      id: 'c4',
      title: 'Если нет CLAUDE.md',
      text: 'Нет CLAUDE.md, но есть AGENTS.md? Claude прочтёт его вместо памятки, а в сессии появится строка «no CLAUDE.md found; AGENTS.md loaded».',
      unlocks: ['file-agents-md'],
    },
  ],

  zones: [
    { id: 'z1', text: 'Рынок Памяти. Фонарики, прилавки… и все что-то забыли.' },
    { id: 'z2', text: 'Табло цен: болт — сто двадцать пять монет? Тут что-то не так.', when: { notDone: ['t1'] } },
    { id: 'z3', text: 'Ворота рынка. Часы над ними стоят — и замок вместе с ними.', when: { gateOpen: false } },
  ],
};
