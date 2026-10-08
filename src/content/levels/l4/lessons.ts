// Level 4 — «Квартал Инструментов»: extending Claude Code (MCP, skills, hooks; bonus: settings and plugins).
// Facts: docs/claude-code-reference.md §4. Tool rows and screen layouts are flavour (UNVERIFIED there);
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
const warn = (text: string): TermLine => ({ text, style: 'warn' });
const err = (text: string): TermLine => ({ text, style: 'err' });

// Answer pattern parts (anchored, case-insensitive, see match.ts).
/** A prompt in words: not a slash command, not shell mode, not the removed # shortcut. */
const WORDS = '(?![/!#])';
const HTTP = '(?:--transport[ =]|-t ?)http';
const PROJECT = '(?:--scope[ =]|-s ?)project';
const SENSORS_URL = `["']?https://sensors\\.city/mcp/?["']?`;
const SENSOR_WORDS = '(?:sensors|датчик|сенсор|показани|дожд|ливн|rain|mcp)';
const SIGN_WORDS = '(?:лап[шщ]|lapsha|вывеск|sign|bazaar)';

export const meta: LevelMeta = {
  title: 'Квартал Инструментов',
  subtitle: 'Расширяем Claude Code: MCP, скиллы и хуки',
  topics: [
    'MCP-серверы: claude mcp add, claude mcp list, /mcp, .mcp.json',
    'Скиллы: SKILL.md, /имя аргументы, $ARGUMENTS',
    'Хуки: события, matcher, exit 2, /hooks',
    'Бонус: слои настроек, /config, плагины',
  ],
  intro: [
    'Квартал Инструментов никогда не спал: здесь торговали переходниками, рецептами и крючками для старых терминалов. Теперь прилавки мокнут под дождём, ливнёвка захлёбывается, весы врут, а вывески гаснут.',
    'Claude Code умеет больше, чем читать код. Его можно подключить к другим системам, научить повторяющимся процедурам и заставить кое-что делать всегда — без напоминаний.',
    'Цель: оживить ливнёвку, весы и вывески. Тогда откроются ворота к Башне Ядра.',
  ],
  outro: [
    'Квартал снова торгует. Ты подключил MCP-сервер для всей бригады, записал скилл с аргументами и повесил хуки, которые срабатывают сами.',
    'Запомни по-симиному: переходник — к чужой системе, рецепт — на повтор, крючок — на «всегда». Впереди Башня Ядра.',
  ],
};

export const lessons: LevelLessons = {
  terminals: [
    // ───────────── t1 · MCP ─────────────
    {
      id: 't1',
      title: 'Ливнёвка',
      required: true,
      challenge: {
        title: 'Переходник к датчикам',
        brief:
          'Квартал заливает: насосы ливнёвки не знают, сколько льёт. Показания есть в городской сенсорной сети, но Claude её не видит — ему нужен MCP-сервер.',
        cwd: '~/city/drains',
        unlocks: ['concept-mcp-server', 'cli-mcp-add', 'concept-mcp-scopes', 'file-mcp-json', 'cli-mcp-list', 'slash-mcp'],
        steps: [
          {
            id: 's1',
            kind: 'command',
            prompt: 'shell',
            task: 'Подключи сенсорную сеть как MCP-сервер sensors: удалённый, по HTTP, адрес https://sensors.city/mcp. Он нужен всей бригаде — запиши его в проект (scope project).',
            accept: [`claude mcp add (?:${HTTP} ${PROJECT}|${PROJECT} ${HTTP}) ["']?sensors["']? ${SENSORS_URL}`],
            example: 'claude mcp add --transport http --scope project sensors https://sensors.city/mcp',
            hints: [
              'Всё про MCP-серверы в оболочке начинается с claude mcp, а подключает подкоманда add.',
              'До имени сервера нужны два флага: --transport http и --scope project. Потом — имя и адрес.',
              'Шаблон: claude mcp add --transport http --scope project <имя> <адрес>',
            ],
            wrong: [
              {
                match: `claude mcp add .*(?:--transport[ =]|-t ?)sse.*`,
                reply: 'SSE устарел. Удалённые серверы подключают по HTTP — если надо, он сам откатится на SSE.',
              },
              {
                match: `(?!.*(?:--scope[ =]|-s ?)project)claude mcp add .*`,
                reply: 'Нужен scope project — он пишет .mcp.json для всей бригады. Без --scope сервер будет только твоим (local), а user — твоим во всех проектах.',
              },
              {
                // The name comes before some flag: options must precede the server name.
                match: `claude mcp add (?=.*["']?sensors["']? .*(?:--transport|--scope|-t |-s )).*`,
                reply: 'Флаги ставь до имени сервера: сначала --transport и --scope, потом имя и адрес.',
              },
              {
                match: `(?!.*(?:--transport|-t ?http))claude mcp add .*`,
                reply: 'Без --transport Claude решит, что это локальная программа (stdio). Для адреса в сети нужен http.',
              },
            ],
            output: [
              code('Added HTTP MCP server sensors with URL: https://sensors.city/mcp'),
              code('to project config'),
              dim('В корне проекта появился .mcp.json:'),
              code('{'),
              code('  "mcpServers": {'),
              code('    "sensors": { "type": "http", "url": "https://sensors.city/mcp" }'),
              code('  }'),
              code('}'),
            ],
            explain:
              'HTTP — рекомендуемый транспорт для удалённых серверов. Файл .mcp.json коммитят, и переходник появляется у каждого, кто откроет репозиторий.',
          },
          {
            id: 's2',
            kind: 'command',
            prompt: 'shell',
            task: 'Проверь список всех MCP-серверов проекта и их статус.',
            accept: ['claude mcp list'],
            example: 'claude mcp list',
            hints: ['Тот же раздел claude mcp, только подкоманда другая.', 'Подкоманда, которая выводит список, — list.'],
            wrong: [
              { match: 'claude mcp get(?: .*)?', reply: 'get подробно покажет один сервер. А нужен весь список.' },
              { match: '/mcp.*', reply: 'Это команда внутри сессии, а сессия ещё не запущена. В оболочке список даёт claude mcp …' },
              { match: 'claude mcp', reply: 'Почти: допиши подкоманду, которая выводит список.' },
            ],
            output: [code('sensors: https://sensors.city/mcp (HTTP)'), warn('  ⏸ Pending approval (run `claude` to approve)')],
            explain:
              'claude mcp list — быстрый осмотр переходников: ✔ Connected, ! Needs authentication, ✘ Failed to connect или ⏸ Pending approval.',
          },
          {
            id: 's3',
            kind: 'command',
            prompt: 'shell',
            task: 'Сервер ждёт одобрения, а одобряют его в сессии. Запусти Claude Code в этой папке.',
            accept: ['claude'],
            example: 'claude',
            hints: ['Сессию открывает одно слово.', 'Это имя самого помощника, строчными буквами.'],
            wrong: [
              { match: 'claude mcp.*', reply: 'С настройкой сервера всё. Теперь просто открой сессию — одним словом.' },
              { match: 'claude code', reply: 'Команда короче — одно слово.' },
            ],
            explain: 'Серверы из .mcp.json одобряют в интерактивной сессии: Claude спросит о них сам, как только запустится.',
          },
          {
            id: 's4',
            kind: 'choice',
            style: 'quiz',
            task: 'Claude нашёл в .mcp.json новый сервер и спрашивает, подключать ли его. Реши.',
            context: [dim('В .mcp.json найден сервер sensors (https://sensors.city/mcp).')],
            question: 'Подключить sensors?',
            options: [
              { label: 'Да: этот сервер я добавил сам', correct: true, reply: 'Сервер одобрен — теперь Claude может звать его инструменты.' },
              {
                label: 'Нет: проектным серверам доверять нельзя',
                reply: 'Осторожность — это хорошо, но сервер твой. Чужой .mcp.json сначала прочти, потом решай.',
              },
              { label: 'Удалить .mcp.json, чтобы не спрашивал', reply: 'Тогда переходник пропадёт у всей бригады.' },
            ],
            hints: ['Этот сервер ты добавил сам — минуту назад.', 'Чужой .mcp.json стоит сначала прочесть. Свой можно одобрить смело.'],
            explain:
              'Серверы из .mcp.json приходят вместе с репозиторием, поэтому Claude спрашивает, доверяешь ли ты им. Свои — смело, чужие — только прочитав файл.',
          },
          {
            id: 's5',
            kind: 'command',
            prompt: 'claude',
            task: 'Посмотри прямо из сессии, подключён ли sensors и сколько у него инструментов.',
            accept: ['/mcp'],
            example: '/mcp',
            hints: ['Внутри сессии у MCP своя слэш-команда.', 'Она называется как сам протокол — три буквы после слэша.'],
            wrong: [
              { match: 'claude mcp list', reply: 'Это команда оболочки. Внутри сессии есть своя — со слэшем.' },
              {
                match: '/context.*',
                reply: '/context покажет, сколько места занимают MCP-инструменты. А статус серверов — в другой команде.',
              },
              { match: '/mcp .+', reply: 'С аргументом /mcp выполнит действие, например reconnect. А список откроет сама команда, без аргументов.' },
            ],
            output: [box('sensors · ✔ connected · 3 tools')],
            explain: '/mcp — пульт переходников внутри сессии: статус, число инструментов, вход через браузер, Reconnect и Disable.',
          },
          {
            id: 's6',
            kind: 'choice',
            style: 'quiz',
            task: 'Тётя Сима хочет свой переходник к кассе: только для себя, но во всех своих проектах. Какой scope ей подсказать?',
            question: 'Какой scope нужен Симе?',
            options: [
              { label: 'user — в ~/.claude.json, во всех её проектах', correct: true, reply: 'Да: user — это «мне, везде». Бригада его не увидит.' },
              { label: 'project — в .mcp.json, вместе с репозиторием', reply: 'Так переходник уедет в git ко всей бригаде. А касса — личное дело Симы.' },
              { label: 'local — только в этом проекте', reply: 'local — это «мне, только здесь». А нужен во всех проектах.' },
            ],
            hints: ['Два вопроса: кому нужен переходник и где.', 'local — только здесь, project — всем в репозитории. Остаётся третий.'],
            explain:
              'local (по умолчанию) и user хранятся в ~/.claude.json, project — в .mcp.json. Если имена совпали, главнее local, потом project, потом user.',
          },
          {
            id: 's7',
            kind: 'command',
            prompt: 'claude',
            task: 'Попроси Claude взять свежие показания датчиков дождя и найти, почему насосы ливнёвки не включаются.',
            accept: [`${WORDS}(?=.*${SENSOR_WORDS}).{10,}`],
            example: 'проверь датчики дождя и найди, почему насосы не включаются',
            hints: [
              'Пиши обычными словами — Claude сам вызовет инструменты sensors.',
              'Например: «проверь датчики дождя и найди, почему насосы не включаются».',
            ],
            wrong: [
              {
                match: `(?!.*${SENSOR_WORDS}).*(?:насос|pump|почин|исправ|fix).*`,
                reply: 'Из кода Claude дождя не видит. Попроси его заглянуть в датчики — sensors теперь подключён.',
              },
              { match: '/mcp.*', reply: 'Сервер уже подключён. Теперь просто попроси Claude словами — он сам вызовет инструменты sensors.' },
            ],
            output: [
              tool('mcp__sensors__rain_level(zone: "bazaar")'),
              result('41 mm/h · rising'),
              tool('Read(src/thresholds.ts)'),
              result('Read 18 lines'),
              say('Льёт 41 мм/ч, а насосы включаются только с 400. Лишний ноль.'),
              tool('Edit(src/thresholds.ts)'),
              del('export const PUMP_ON_MM_H = 400;'),
              add('export const PUMP_ON_MM_H = 40;'),
              say('Порог исправлен. Насосы ливнёвки снова качают воду.'),
              dim('Вода с мостовой уходит в решётки.'),
            ],
            explain:
              'MCP даёт Claude живые данные: не нужно переписывать показания в чат руками. Имена вида mcp__sensors__… пригодятся в правилах разрешений и в хуках.',
          },
        ],
      },
    },

    // ───────────── t2 · Skills ─────────────
    {
      id: 't2',
      title: 'Весы рынка',
      required: true,
      requires: ['t1'],
      challenge: {
        title: 'Рецепт калибровки',
        brief:
          'Весы на прилавках врут. Калибровка описана в docs/calibration.md, и проделать её нужно на каждом из двенадцати прилавков — одно и то же, снова и снова.',
        cwd: '~/city/scales',
        unlocks: ['file-skill-md', 'concept-skill-arguments', 'concept-skill-manual-only', 'slash-skill-run'],
        steps: [
          {
            id: 's1',
            kind: 'choice',
            style: 'quiz',
            task: 'Калибровку будут повторять все торговцы рынка, на всех прилавках. Куда записать процедуру?',
            question: 'Где хранить процедуру калибровки?',
            options: [
              {
                label: 'Скилл в проекте: .claude/skills/calibrate/SKILL.md',
                correct: true,
                reply: 'Рецепт лежит в репозитории: он есть у всех и запускается командой.',
              },
              { label: 'Скилл для себя: ~/.claude/skills/calibrate/SKILL.md', reply: 'Так рецепт будет только у тебя. А калибруют весы все торговцы.' },
              {
                label: 'Целиком в памятку CLAUDE.md',
                reply: 'CLAUDE.md грузится в каждую сессию. Длинная процедура занимала бы контекст, даже когда ты чинишь не весы.',
              },
            ],
            hints: [
              'Процедура нужна не всегда, а только когда калибруешь.',
              'Рецепт, который запускают командой, — это скилл. Поделиться с бригадой помогает папка проекта.',
            ],
            explain: 'Скилл загружается, когда нужен: по команде или когда задача подходит под его описание. В CLAUDE.md — только то, что важно всегда.',
          },
          {
            id: 's2',
            kind: 'command',
            prompt: 'claude',
            task: 'Попроси Claude сделать проектный скилл calibrate по инструкции docs/calibration.md. Файл покажи упоминанием, чтобы Claude получил его целиком.',
            accept: [`${WORDS}(?=.*@(?:\\./)?docs/calibration\\.md)(?=.*calibrate).{12,}`],
            example: 'сделай проектный скилл calibrate по @docs/calibration.md',
            hints: [
              'Упоминание файла начинается с @ — помнишь Рынок Памяти?',
              'Назови имя скилла и упомяни файл: @docs/calibration.md.',
              'Например: «сделай проектный скилл calibrate по @docs/calibration.md».',
            ],
            wrong: [
              {
                match: '(?=.*calibrate)(?!.*@)(?=.*calibration\\.md).*',
                reply: 'Почти! Поставь @ перед путём — тогда Claude сразу получит весь файл.',
              },
              {
                match: '(?=.*calibrate)(?!.*calibration\\.md).*',
                reply: 'Claude не знает вашу процедуру. Покажи ему инструкцию: упомяни docs/calibration.md через @.',
              },
              { match: '(?!.*calibrate)(?=.*@(?:\\./)?docs/calibration\\.md).*', reply: 'Дай скиллу имя calibrate — по нему его и будут звать.' },
              { match: '/skills.*', reply: '/skills покажет список скиллов. А новый проще всего создать просьбой к Claude.' },
            ],
            output: [
              tool('Write(.claude/skills/calibrate/SKILL.md)'),
              result('Wrote 8 lines'),
              code('---'),
              code('name: calibrate'),
              code('description: Calibrates the scales of one market stall'),
              code('---'),
              code('Calibrate the scales of stall 3:'),
              code('1. Run `npm run weigh -- --stall 3`'),
              code('2. Fix the factor of stall 3 in config/stalls.json'),
              code('3. Run the weigh check again'),
            ],
            explain:
              'SKILL.md — рецепт: в шапке имя и описание (по описанию Claude понимает, когда его взять), ниже — шаги. Проектные скиллы лежат в .claude/skills/ и попадают в git.',
          },
          {
            id: 's3',
            kind: 'command',
            prompt: 'claude',
            task: 'Claude взял номер 3 из примера, и рецепт годится только для третьего прилавка. Попроси заменить номер на подстановку, куда встанет всё, что напишут после /calibrate.',
            accept: [`${WORDS}.*\\$ARGUMENTS.*`, `${WORDS}.*\\$0(?!\\d).*`],
            example: 'замени номер 3 на $ARGUMENTS',
            hints: [
              'В SKILL.md есть особое слово для аргументов команды.',
              'Оно начинается с $ и пишется заглавными: $ARG…',
              'Например: «замени номер 3 на $ARGUMENTS».',
            ],
            wrong: [
              {
                match: '.*\\$1(?!\\d).*',
                reply: '$1 — это второй аргумент: счёт идёт с нуля. Для всего, что после имени, есть $ARGUMENTS.',
              },
              {
                match: '.*(?:\\{\\{|%1|\\$\\{|\\$stall|<stall>).*',
                reply: 'Такой подстановки скиллы не знают. Нужно особое слово: $ и заглавные буквы.',
              },
              {
                match: '(?!.*\\$).*(?:аргумент|argument).*',
                reply: 'Верно, нужен аргумент! Теперь напиши саму подстановку — $ и слово заглавными.',
              },
              { match: '/calibrate.*', reply: 'Рецепт пока годится только для прилавка 3. Сначала попроси Claude поправить SKILL.md.' },
            ],
            output: [
              tool('Edit(.claude/skills/calibrate/SKILL.md)'),
              del('Calibrate the scales of stall 3:'),
              add('Calibrate the scales of stall $ARGUMENTS:'),
              del('1. Run `npm run weigh -- --stall 3`'),
              add('1. Run `npm run weigh -- --stall $ARGUMENTS`'),
              del('2. Fix the factor of stall 3 in config/stalls.json'),
              add('2. Fix the factor of stall $ARGUMENTS in config/stalls.json'),
              say('Готово. Теперь /calibrate 12 подставит 12 во все три места.'),
            ],
            explain:
              '$ARGUMENTS — всё, что написано после имени скилла; $0, $1 — отдельные аргументы, счёт с нуля. Без подстановки аргументы просто допишутся в конец.',
          },
          {
            id: 's4',
            kind: 'choice',
            style: 'quiz',
            task: 'Калибровка на минуту останавливает весы. Сима не хочет, чтобы Claude запускал рецепт сам, без команды. Что дописать в шапку SKILL.md?',
            question: 'Какая строка нужна в шапке?',
            options: [
              { label: 'disable-model-invocation: true', correct: true, reply: 'Теперь рецепт запускается только твоей командой.' },
              {
                label: 'description: никогда не запускай сам',
                reply: 'По описанию Claude решает, когда брать скилл. Запрет так не ставят — для него есть отдельное поле.',
              },
              { label: 'Ничего: скилл и так запускается только командой', reply: 'Нет: Claude берёт скилл и сам, если задача подходит под описание.' },
            ],
            hints: ['Нужна настройка в шапке, а не просьба словами.', 'Поле буквально «отключает вызов моделью».'],
            output: [tool('Edit(.claude/skills/calibrate/SKILL.md)'), code('name: calibrate'), add('disable-model-invocation: true')],
            explain:
              'Ручной запуск — для рецептов с последствиями: деплой, коммит, остановка оборудования. Остальные пусть Claude берёт сам, по описанию.',
          },
          {
            id: 's5',
            kind: 'command',
            prompt: 'claude',
            task: 'Прилавок 7 врёт сильнее всех. Запусти рецепт для него.',
            accept: ['/calibrate (?:stall |прилавок |№ ?|#)?7'],
            example: '/calibrate 7',
            hints: ['Скилл запускают как слэш-команду — по имени.', 'После имени через пробел — номер прилавка.', 'Шаблон: /<имя скилла> <номер>'],
            wrong: [
              { match: '/calibrate', reply: 'Без номера $ARGUMENTS останется пустым. Допиши номер прилавка после имени.' },
              { match: '/calibrate \\$arguments', reply: '$ARGUMENTS — это место в рецепте. При запуске пишут само значение — номер прилавка.' },
              { match: '/calibrate (?:stall |прилавок |№ ?|#)?(?!7$)\\d+', reply: 'Не тот прилавок: сильнее всех врёт седьмой.' },
              { match: '/skills.*', reply: '/skills покажет список скиллов. А запускают рецепт его именем, со слэшем.' },
            ],
            output: [
              tool('Bash(npm run weigh -- --stall 7)'),
              result('stall 7: drift +412 g'),
              tool('Edit(config/stalls.json)'),
              del('"7": { "factor": 1.000 },'),
              add('"7": { "factor": 0.961 },'),
              tool('Bash(npm run weigh -- --stall 7)'),
              result('stall 7: drift 0 g · ok'),
              say('Прилавок 7 откалиброван: весы снова честные.'),
              dim('Сима кладёт на весы гирю. Ровно килограмм.'),
            ],
            explain:
              'Один раз записал рецепт — дальше одна команда на прилавок. Так же устроены /deploy, /fix-issue 123 и любые повторяющиеся процедуры.',
          },
        ],
      },
    },

    // ───────────── t3 · Hooks ─────────────
    {
      id: 't3',
      title: 'Вывески',
      required: true,
      requires: ['t2'],
      challenge: {
        title: 'Крючки для вывесок',
        brief:
          'Вывески квартала гаснут: каждая кривая правка signs/bazaar.json роняет их контроллер. Проверка scripts/check-signs.sh есть, но её забывают запускать.',
        cwd: '~/city/signs',
        unlocks: ['concept-hooks', 'concept-hook-events', 'concept-hook-matcher', 'concept-hook-exit-2', 'slash-hooks'],
        steps: [
          {
            id: 's1',
            kind: 'command',
            prompt: 'claude',
            task: 'Сначала посмотри, что говорит проверка. Запусти scripts/check-signs.sh прямо из строки Claude — сам, не прося Claude.',
            accept: ['! ?(?:bash |sh )?(?:\\./)?scripts/check-signs\\.sh'],
            example: '! ./scripts/check-signs.sh',
            hints: [
              'В строке Claude есть режим оболочки — помнишь Рынок Памяти?',
              'Строка, которая начинается с «!», сразу выполняется как команда.',
              'Например: ! ./scripts/check-signs.sh',
            ],
            wrong: [
              {
                match: '(?:bash |sh )?(?:\\./)?scripts/check-signs\\.sh',
                reply: 'Так это уйдёт Claude как просьба. Чтобы запустить самому, начни строку с «!».',
              },
              { match: '! ?(?:\\./)?check-signs(?:\\.sh)?', reply: 'Скрипт лежит в папке scripts — укажи путь целиком.' },
              {
                match: '(?!!).*check-signs.*',
                reply: 'Claude справился бы и сам, но задача — запустить проверку самому. Начни строку с «!».',
              },
            ],
            output: [
              code('signs/bazaar.json:14: unknown glyph "Щ" in "ЛАПЩА"'),
              code('1 error · sign controller will not start'),
              say('Проверка падает на вывеске у входа: в слове ЛАПЩА опечатка.'),
              say('Пока ошибка в файле, контроллер вывесок не стартует.'),
            ],
            explain: '«!» запускает команду сразу, а Claude видит вывод и отвечает на него. Удобно, когда ты сам знаешь, что запустить.',
          },
          {
            id: 's2',
            kind: 'choice',
            style: 'quiz',
            task: 'В CLAUDE.md давно написано: «после каждой правки вывесок запускай check-signs.sh». Но Claude иногда забывает — и квартал гаснет. Как быть?',
            question: 'Как сделать проверку обязательной?',
            options: [
              { label: 'Хук: проверка запустится сама после каждой правки', correct: true, reply: 'Хук срабатывает всегда — без спроса и без забывчивости.' },
              { label: 'Переписать правило в CLAUDE.md заглавными буквами', reply: 'CLAUDE.md — совет, а не гарантия. Громкость тут не поможет.' },
              { label: 'Напоминать Claude в каждом запросе', reply: 'Тогда забывать будешь ты. «Всегда» — работа для автоматики.' },
            ],
            hints: ['Нужно не «попросить», а «сделать обязательным».', 'Команда, которая запускается сама на событии, — это хук.'],
            explain: 'CLAUDE.md подсказывает, хук гарантирует. Всё, что должно случаться каждый раз без исключений, — кандидат в хуки.',
          },
          {
            id: 's3',
            kind: 'command',
            prompt: 'claude',
            task: 'Попроси Claude добавить в .claude/settings.json хук: после каждой правки файла (инструменты Edit и Write) запускать scripts/check-signs.sh.',
            accept: [`${WORDS}(?!.*PreToolUse)(?=.*(?:hook|хук|крюч|PostToolUse))(?=.*check-signs).{12,}`],
            example: 'добавь в .claude/settings.json хук: после Edit и Write запускать scripts/check-signs.sh',
            hints: [
              'Опиши Claude, что и когда должно запускаться само.',
              'Назови три вещи: хук, «после Edit и Write», скрипт scripts/check-signs.sh.',
              'Например: «добавь хук: после Edit и Write запускать scripts/check-signs.sh».',
            ],
            wrong: [
              {
                match: '/hooks.*',
                reply: '/hooks теперь только показывает хуки — добавить через него нельзя. Попроси Claude или впиши JSON сам.',
              },
              { match: '(?=.*PreToolUse).*', reply: 'PreToolUse срабатывает до правки — проверять ещё нечего. Нужно событие после инструмента.' },
              { match: '(?=.*(?:hook|хук|крюч|PostToolUse))(?!.*check-signs).*', reply: 'Какой скрипт запускать? Назови его: scripts/check-signs.sh.' },
              { match: '(?=.*CLAUDE\\.md)(?!.*(?:hook|хук|крюч)).*', reply: 'Это снова совет в памятке. Нужен хук в .claude/settings.json.' },
            ],
            output: [
              tool('Edit(.claude/settings.json)'),
              add('"hooks": {'),
              add('  "PostToolUse": [{'),
              add('    "matcher": "Edit|Write",'),
              add('    "hooks": [{ "type": "command",'),
              add('      "command": "$CLAUDE_PROJECT_DIR/scripts/check-signs.sh" }]'),
              add('  }]'),
              add('}'),
              say('Хук PostToolUse запустит проверку после каждого Edit и Write.'),
            ],
            explain:
              'matcher выбирает инструменты: Edit|Write — правки файлов, Bash — команды, mcp__.* — все MCP-инструменты. Хук в .claude/settings.json попадёт в git и сработает у всей бригады.',
          },
          {
            id: 's4',
            kind: 'command',
            prompt: 'claude',
            task: 'Проверь, что хук на месте и из какого он файла.',
            accept: ['/hooks'],
            example: '/hooks',
            hints: ['У хуков, как и у MCP, есть своя слэш-команда.', 'Она называется как сами хуки, по-английски.'],
            wrong: [
              { match: '/hooks .+', reply: 'Хватит самой команды — аргументы ей не нужны.' },
              { match: '/config.*', reply: 'Это экран настроек. Хуки собраны в своём списке.' },
              { match: '/memory.*', reply: '/memory — про памятки CLAUDE.md. Хуки — в другой команде.' },
            ],
            output: [
              box('PostToolUse'),
              box('  Edit|Write → $CLAUDE_PROJECT_DIR/scripts/check-signs.sh'),
              box('  источник: .claude/settings.json (проект)'),
              dim('Только просмотр. Чтобы изменить хук, правь JSON или попроси Claude.'),
            ],
            explain:
              '/hooks — только просмотр: какие хуки действуют и откуда каждый. Раньше через него хуки редактировали, теперь — правкой JSON или просьбой к Claude.',
          },
          {
            id: 's5',
            kind: 'choice',
            style: 'quiz',
            task: 'Второй хук-сторож не даёт днём перезапускать все вывески разом — иначе погаснет весь рынок. Выбери, с каким кодом ему выйти.',
            context: [
              dim('Сторож для PreToolUse с matcher "Bash" — .claude/hooks/guard.sh:'),
              code('if market_is_open && grep -q "restart-all"; then'),
              code('  echo "Рынок открыт: перезапуск только ночью" >&2'),
              code('  exit ?'),
              code('fi'),
            ],
            question: 'Какой код выхода остановит команду и передаст Claude причину?',
            options: [
              { label: 'exit 2', correct: true, reply: 'Код 2 — блокирующая ошибка: вызов отменён, а текст из stderr Claude получит как причину.' },
              { label: 'exit 1', reply: 'Любой код, кроме 0 и 2, — неблокирующая ошибка: будет уведомление, а команда пройдёт.' },
              { label: 'exit 0', reply: '0 значит «всё в порядке». Команда пройдёт, и рынок погаснет.' },
            ],
            hints: ['Ноль значит «всё хорошо».', 'Блокирует только один особый код — и он больше единицы.'],
            output: [dim('Сторож готов: днём restart-all не пройдёт.')],
            explain:
              'Exit 2 в PreToolUse — стоп-кран: действие не случится, а Claude узнает почему. Хук с логикой («только днём») умеет то, чего не умеют простые правила разрешений.',
          },
          {
            id: 's6',
            kind: 'command',
            prompt: 'claude',
            task: 'Теперь попроси Claude исправить вывеску ЛАПША в signs/bazaar.json и включить её.',
            accept: [`${WORDS}(?=.*${SIGN_WORDS}).{8,}`],
            example: 'исправь вывеску ЛАПША в signs/bazaar.json и включи её',
            hints: ['Обычная просьба — хуки сработают сами.', 'Например: «исправь вывеску ЛАПША в signs/bazaar.json и включи её».'],
            wrong: [
              { match: '/hooks.*', reply: 'Хуки на месте. Теперь просто попроси Claude починить вывеску.' },
              { match: `(?!.*${SIGN_WORDS}).*(?:почин|исправ|fix).*`, reply: 'Что чинить? Назови вывеску ЛАПША или файл signs/bazaar.json.' },
            ],
            output: [
              tool('Edit(signs/bazaar.json)'),
              del('"text": "ЛАПЩА",'),
              add('"text": "ЛАПША",'),
              dim('хук PostToolUse: check-signs.sh — 14 вывесок, ошибок нет'),
              tool('Bash(npm run restart-all)'),
              err('хук PreToolUse: Рынок открыт: перезапуск только ночью'),
              say('Сторож не дал перезапустить всё разом. Включу одну вывеску.'),
              tool('Bash(npm run reload -- lapsha)'),
              result('lapsha: on'),
              say('Готово: над рынком снова горит ЛАПША.'),
            ],
            explain:
              'Ты не просил запускать проверку и не следил за перезапуском — хуки сделали это сами. Это и есть правила, которые нельзя забыть.',
          },
        ],
      },
    },

    // ───────────── t4 · bonus: settings and plugins ─────────────
    {
      id: 't4',
      title: 'Лавка Джейсона',
      required: false,
      challenge: {
        title: 'Слои настроек и наборы',
        brief:
          'Касса квартала открывает Claude в режиме планирования, хотя в твоих личных настройках стоит другое. Разберись, какой файл главнее, и поставь набор для коммитов.',
        cwd: '~/city/kassa',
        startMode: 'plan',
        unlocks: ['file-settings-layers', 'concept-settings-precedence', 'slash-config', 'slash-plugin', 'concept-plugin-skills'],
        steps: [
          {
            id: 's1',
            kind: 'choice',
            style: 'quiz',
            task: 'Сессия открылась в plan mode. Посмотри на два файла настроек и объясни почему.',
            context: [
              dim('~/.claude/settings.json — твои личные:'),
              code('{ "permissions": { "defaultMode": "acceptEdits" } }'),
              dim('.claude/settings.json — общий файл кассы:'),
              code('{ "permissions": { "defaultMode": "plan" } }'),
            ],
            question: 'Почему сессия стартовала в plan mode?',
            options: [
              { label: 'Настройки проекта главнее личных', correct: true, reply: 'Верно: чем ближе к проекту, тем главнее.' },
              { label: 'Побеждает файл, который правили последним', reply: 'Время правки не важно. Важен слой: проект перебивает личные настройки.' },
              { label: 'Личный файл сломан', reply: 'С ним всё в порядке — его просто перебивает проект.' },
            ],
            hints: ['Слоёв несколько, и у каждого своё место в очереди.', 'Чем ближе слой к проекту, тем он главнее.'],
            explain:
              'Порядок: managed > флаги командной строки > .claude/settings.local.json > .claude/settings.json > ~/.claude/settings.json. Списки вроде permissions.allow не перебиваются, а складываются.',
          },
          {
            id: 's2',
            kind: 'key',
            task: 'Сегодня ты не планируешь, а настраиваешь. Переключи эту сессию в auto mode.',
            keys: ['Shift+Tab'],
            untilMode: 'auto',
            example: 'Shift+Tab',
            hints: ['Режим меняет одно сочетание клавиш — следи за строкой статуса.', 'Shift+Tab по кругу, пока не увидишь ⏵⏵ auto mode on.'],
            explain: 'Shift+Tab меняет режим только в этой сессии. С какого режима сессия начнётся, решают файлы настроек.',
          },
          {
            id: 's3',
            kind: 'choice',
            style: 'quiz',
            task: 'Тебе в кассе удобнее начинать в accept edits, но общий файл бригады трогать нельзя. Куда записать твой режим?',
            question: 'В какой файл?',
            options: [
              { label: '.claude/settings.local.json', correct: true, reply: 'Личный слой проекта: он главнее общего и не попадает в git.' },
              { label: '.claude/settings.json', reply: 'Это общий файл: поменяешь режим всей бригаде.' },
              { label: '~/.claude/settings.json', reply: 'Там acceptEdits уже стоит — и проигрывает проекту. Нужен слой главнее проектного.' },
            ],
            hints: ['Нужен слой главнее проектного, но только твой.', 'Он лежит рядом с общим файлом и не попадает в git.'],
            output: [
              tool('Write(.claude/settings.local.json)'),
              code('{ "permissions": { "defaultMode": "acceptEdits" } }'),
              say('Со следующего запуска касса откроется у тебя в accept edits.'),
            ],
            explain: 'settings.local.json — для личных привычек в одном проекте. В git он не попадает, поэтому бригада ничего не заметит.',
          },
          {
            id: 's4',
            kind: 'command',
            prompt: 'claude',
            task: 'Джейсон не любит болтовни: когда он сам запускает команду через «!», Claude должен молчать. Поставь ключ respondToBashCommands в false одной командой настроек.',
            accept: ['/config respondToBashCommands ?= ?false'],
            example: '/config respondToBashCommands=false',
            hints: [
              'Для настроек есть слэш-команда — «конфигурация» по-английски.',
              'После /config через пробел — ключ=значение.',
              'Шаблон: /config <ключ>=<значение>',
            ],
            wrong: [
              { match: '/config', reply: 'Так откроется экран настроек. А ключ можно поставить сразу: /config ключ=значение.' },
              { match: '/config respondToBashCommands ?= ?true', reply: 'true — как сейчас: Claude отвечает на вывод. Нужно false.' },
              { match: '/config respondToBashCommands:? false', reply: 'Соедини ключ и значение знаком «=».' },
              { match: '/memory.*', reply: '/memory — про CLAUDE.md и автопамять. Настройки ставит другая команда.' },
            ],
            output: [dim('Готово: после «!»-команд Claude больше не отвечает сам.')],
            explain:
              '/config без аргументов открывает экран настроек, а /config ключ=значение ставит ключ сразу. Пишет он в основном в ~/.claude/settings.json — твой личный слой.',
          },
          {
            id: 's5',
            kind: 'command',
            prompt: 'claude',
            task: 'Джейсон советует набор commit-commands из официального маркетплейса claude-plugins-official. Поставь его.',
            accept: ['/plugin install commit-commands@claude-plugins-official'],
            example: '/plugin install commit-commands@claude-plugins-official',
            hints: [
              'Наборы — это плагины, и у них своя слэш-команда.',
              'Команда /plugin, подкоманда install, потом набор@маркетплейс.',
              'Шаблон: /plugin install <набор>@<маркетплейс>',
            ],
            wrong: [
              { match: 'claude plugin install.*', reply: 'Это форма для оболочки. Внутри сессии — слэш-команда.' },
              { match: '/plugin marketplace add.*', reply: 'Официальный маркетплейс уже подключён сам. Ставь набор сразу.' },
              { match: '/plugin install commit-commands', reply: 'Допиши, откуда набор: commit-commands@claude-plugins-official.' },
              {
                match: '/plugin',
                reply: '/plugin откроет вкладки — там тоже можно найти набор. Но быстрее сразу: /plugin install имя@маркетплейс.',
              },
            ],
            output: [dim('Набор commit-commands найден. Осталось выбрать, для кого его поставить.')],
            explain:
              'Плагин — коробка со скиллами, агентами, хуками и MCP-серверами. Он может запускать код, так что ставь только то, чему доверяешь.',
          },
          {
            id: 's6',
            kind: 'choice',
            style: 'quiz',
            task: 'Набор нужен тебе самому — во всех твоих проектах, не только в кассе. Выбери вариант установки.',
            question: 'Как установить commit-commands?',
            options: [
              { label: 'Install for you (user scope)', correct: true, reply: 'Набор будет во всех твоих проектах.' },
              {
                label: 'Install for all collaborators on this repository (project scope)',
                reply: 'Так набор получат все, кто работает с кассой. А нужен он только тебе.',
              },
              { label: 'Install for you, in this repo only (local scope)', reply: 'Только в этом репозитории. А нужен во всех проектах.' },
            ],
            hints: ['Тебе одному — значит не для всех коллабораторов.', 'Во всех проектах — значит не только в этом репозитории.'],
            output: [ok('Plugin is now active.')],
            explain: 'Тот же выбор, что у MCP: ты, вся бригада репозитория или ты только здесь. Скиллы плагина получают приставку с его именем.',
          },
          {
            id: 's7',
            kind: 'command',
            prompt: 'claude',
            task: 'Джейсон уже исправил округление в кассе. Закоммить это скиллом commit из нового набора.',
            accept: ['/commit-commands:commit(?: .+)?'],
            example: '/commit-commands:commit',
            hints: ['Скиллы плагина пишутся с приставкой — именем набора.', 'Между набором и скиллом — двоеточие.', 'Шаблон: /<набор>:<скилл>'],
            wrong: [
              { match: '/commit', reply: 'Скиллы плагина живут под его именем: сначала набор, потом двоеточие и скилл.' },
              { match: '/commit-commands', reply: 'Это имя набора. Допиши через двоеточие, какой скилл запустить.' },
              { match: '/commit-commands commit', reply: 'Набор и скилл соединяет двоеточие, без пробела.' },
            ],
            output: [
              tool('Bash(git status --short)'),
              result('M src/round.ts'),
              tool('Bash(git commit -am "fix(kassa): round prices to 0.01")'),
              result('[main 7c1d2e4] fix(kassa): round prices to 0.01'),
              result('1 file changed, 3 insertions(+), 3 deletions(-)'),
              say('Коммит готов. Касса снова считает до копейки.'),
              dim('Джейсон пробивает чек. Сходится.'),
            ],
            explain: 'Плагины с маркетплейса — быстрый способ получить готовые рецепты. Что уже стоит, видно в /plugin на вкладке Installed.',
          },
        ],
      },
    },
  ],

  npcs: [
    {
      id: 'sima',
      name: 'Тётя Сима',
      model: 'npc_round',
      tint: '#5dff7a',
      dialogs: [
        {
          when: { gateOpen: true },
          lines: [
            { text: 'Ворота открыты! Видишь, как квартал засветился? Это ты, железный.', mood: 'happy' },
            { text: 'Теперь у тебя полный ящик: переходник — к чужой системе, рецепт — на повтор, крючок — на «всегда».', mood: 'happy' },
            { text: 'Дальше Башня Ядра. Там сторож Крон: ворчит, но дело знает. Передай от Симы привет.', mood: 'neutral' },
            { text: 'А к Джейсону загляни, если ещё не был. У него наборы, где всё это уже сложено в одну коробку.', mood: 'thinking' },
          ],
        },
        {
          when: { done: ['t2'], notDone: ['t3'] },
          lines: [
            { text: 'Весы честные, торговля пошла! Но рецепт — это совет: Claude может его и не взять.', mood: 'happy' },
            { text: 'А есть дела, которые должны случаться всегда. Каждый раз. Без всяких «ой, забыл».', mood: 'thinking' },
            { text: 'Для них у меня крючки. Хук срабатывает сам на событии: поправил файл — и проверка уже бежит.', mood: 'neutral' },
            { text: 'Вывески у ворот гаснут от каждой кривой правки. Повесь им крючок — терминал там же, у ворот.', mood: 'worried' },
          ],
        },
        {
          when: { done: ['t1'], notDone: ['t2'] },
          lines: [
            { text: 'Вода ушла! Ливнёвка качает. Ты мой герой, железный.', mood: 'happy' },
            { text: 'Следующая беда — весы. Каждый вечер одна и та же калибровка, на всех двенадцати прилавках.', mood: 'worried' },
            { text: 'Делаешь что-то снова и снова — запиши рецепт. Скилл: шаги в файле, Claude достаёт их, когда нужно.', mood: 'neutral' },
            { text: 'Только не пихай рецепты в памятку CLAUDE.md: её Claude читает каждый раз целиком. Рецептам место на полке.', mood: 'thinking' },
          ],
        },
        {
          when: { notDone: ['t1'] },
          lines: [
            { text: 'Ой, новенький! Заходи, не мокни. У Симы всё для Claude: переходники, рецепты, крючки.', mood: 'excited' },
            { text: 'Claude умный, но видит только папку с кодом. Датчики, склады, почта — всё мимо него.', mood: 'thinking' },
            { text: 'Переходник — это MCP-сервер. Подключил — и Claude сам спрашивает у чужой системы, что там творится.', mood: 'neutral' },
            { text: 'Вешают его по-разному: себе в один проект, себе во все проекты — или всей бригаде, через файл в репозитории.', mood: 'neutral' },
            { text: 'Бип? Всей бригаде?', speaker: 'ХАРНИ', mood: 'thinking' },
            { text: 'Ливнёвка третью ночь захлёбывается. Подключи ей сенсорную сеть — да так, чтобы у всей бригады было.', mood: 'worried' },
          ],
        },
        {
          lines: [
            { text: 'Заходи ещё, железный. У Симы всегда что-нибудь найдётся.', mood: 'happy' },
            { text: 'Переходник — к чужой системе. Рецепт — на повтор. Крючок — на «всегда».', mood: 'neutral' },
            { text: 'Запомнил? Вот и молодец.', mood: 'happy' },
          ],
        },
      ],
    },
    {
      id: 'jason',
      name: 'Джейсон',
      model: 'npc_tall',
      tint: '#a66bff',
      dialogs: [
        {
          when: { done: ['t4'] },
          lines: [
            { text: 'Касса считает до копейки, настройки по полочкам, набор стоит. Красота.', mood: 'happy' },
            { text: 'Если Claude ведёт себя странно — сначала проверь, какой слой настроек победил. Обычно дело в нём.', mood: 'thinking' },
            { text: 'И помни: строгий JSON — счастливый JSON.', mood: 'happy' },
          ],
        },
        {
          lines: [
            { text: 'Джейсон. Да, как формат. Нет, не шучу. Я храню настройки квартала.', mood: 'neutral' },
            { text: 'У Claude настройки слоями: твои личные, общие для проекта и личные для проекта. А сверху — от организации.', mood: 'neutral' },
            { text: 'Кто главнее? Чем ближе к делу, тем главнее. Флаг в командной строке перебивает все файлы, кроме настроек организации.', mood: 'thinking' },
            { text: 'И никаких комментариев в JSON. Ни одной висячей запятой. Я проверю.', mood: 'worried' },
            { text: 'Ещё продаю наборы — плагины: скиллы, хуки, MCP в одной коробке. Только читай, что ставишь: плагин может запускать код.', mood: 'neutral' },
            { text: 'Касса опять открывает Claude не в том режиме. Терминал у моей лавки — разберёшься?', mood: 'worried' },
          ],
        },
      ],
    },
  ],

  chips: [
    {
      id: 'c1',
      title: 'Ресурсы MCP',
      text: 'Данные MCP-сервера можно упомянуть через @, как файл: @github:issue://123. Формат — @сервер:протокол://путь.',
      unlocks: ['concept-mcp-resources'],
    },
    {
      id: 'c2',
      title: 'Локальный MCP-сервер',
      text: 'Сервер-программу на своём компьютере подключают так: claude mcp add --transport stdio имя -- команда. Всё после -- — команда сервера, а не флаги Claude.',
      unlocks: ['cli-mcp-add-stdio'],
    },
    {
      id: 'c3',
      title: 'Живые данные в скилле',
      text: 'Строка !`git diff HEAD` в SKILL.md заменяется выводом команды ещё до того, как Claude прочтёт рецепт. Так скилл всегда видит свежие данные.',
      unlocks: ['concept-skill-inject'],
    },
    {
      id: 'c4',
      title: 'Хук на старте сессии',
      text: 'Хук на SessionStart может подсказать Claude контекст: всё, что его скрипт напечатает при выходе с кодом 0, попадёт в сессию.',
      unlocks: ['concept-hook-session-start'],
    },
  ],

  zones: [
    { id: 'z1', text: 'Сколько лавок! Тут продают всё, что подключается к Claude.' },
    { id: 'z2', text: 'Ворота квартала. Замок ждёт ливнёвку, весы и вывески.', when: { gateOpen: false } },
    { id: 'z3', text: 'Лавка «Наборы и настройки». Пахнет свежим JSON.', when: { notDone: ['t4'] } },
  ],
};
