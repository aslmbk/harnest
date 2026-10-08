/**
 * Dev-only content for the UI harness (?mock=1): extra levels and codex entries with long Russian
 * strings, plus a showcase terminal that uses every step kind and every TermStyle.
 * Never imported by the game.
 */
import type { CodexEntry, LevelDef, LevelLessons, LevelMeta } from '../../content/types';
import type { UIContent } from '../context';

const LONG = 'Очень длинная строка для проверки переноса: электроподстанция-распределитель северо-восточного квартала';

const showcase: LevelLessons['terminals'][number] = {
  id: 't1',
  title: 'Витрина вывода',
  required: true,
  challenge: {
    title: 'Все стили терминала',
    brief: 'Стенд, на котором видно каждый вид строк: инструменты, результаты, диффы, рамки и режимы.',
    cwd: '~/city/market/showcase',
    startMode: 'auto',
    unlocks: ['mock-keys-shift-tab', 'mock-concept-plan'],
    steps: [
      {
        id: 's1',
        kind: 'info',
        task: 'Посмотри, как Claude Code показывает свою работу. Нажми Enter, чтобы продолжить.',
        output: [
          { text: 'Сначала посмотрю, как устроен модуль весов, а потом поправлю округление.', style: 'claude' },
          { text: 'Ошибка в `roundPrice()`: цена округляется **до** скидки.', style: 'claude' },
          { text: 'Read(src/scales/price.ts)', style: 'tool' },
          { text: 'Read 88 lines', style: 'result' },
          { text: 'Update(src/scales/price.ts)', style: 'tool' },
          { text: 'Updated src/scales/price.ts with 1 addition and 1 removal', style: 'result' },
          { text: '  const total = roundPrice(base) - discount;', style: 'diffDel' },
          { text: '  const total = roundPrice(base - discount);', style: 'diffAdd' },
          { text: 'Bash(npm test)', style: 'tool' },
          { text: 'PASS  src/scales/price.test.ts', style: 'result' },
          { text: 'Tests: 12 passed, 12 total', style: 'result' },
          { text: 'План проверки:', style: 'box' },
          { text: '1. Прогнать тесты весов', style: 'box' },
          { text: '2. Сверить чек с витриной', style: 'box' },
          { text: '{ "scale": "north", "ok": true }', style: 'code' },
          { text: 'Готово: тесты зелёные.', style: 'ok' },
          { text: 'Внимание: витрина на юге ещё не проверена.', style: 'warn' },
          { text: 'Ошибка: датчик веса 3 не отвечает.', style: 'err' },
          { text: 'Подробнее — в CLAUDE.md.', style: 'accent' },
          { text: 'Вторичный текст, например подпись.', style: 'dim' },
        ],
        explain: 'Каждая строка с ● — действие Claude, строка с ⎿ — его результат.',
      },
      {
        id: 's2',
        kind: 'key',
        task: 'Переключи сессию в режим планирования, чтобы Claude сначала составил план.',
        keys: ['Shift+Tab'],
        example: 'Shift+Tab',
        untilMode: 'plan',
        hints: ['Режимы переключаются одним сочетанием по кругу.', 'Shift и ещё одна клавиша слева.'],
        output: [{ text: 'Хорошо: сначала план, потом правки.', style: 'claude' }],
        explain: 'В режиме планирования Claude читает и думает, но ничего не меняет.',
      },
      {
        id: 's3',
        kind: 'choice',
        style: 'quiz',
        task: 'Ответь на вопрос торговки про CLAUDE.md.',
        question: 'Где Claude Code берёт правила проекта в начале каждой сессии?',
        options: [
          { label: 'Из CLAUDE.md в папке проекта', correct: true, reply: 'Верно: CLAUDE.md читается при старте.' },
          { label: 'Из истории браузера', reply: 'Нет, браузер тут ни при чём.' },
          { label: `${LONG} — и ещё немного текста, чтобы вариант занял две строки`, reply: 'Это просто длинный вариант.' },
        ],
        hints: ['Это файл, который создаёт /init.'],
      },
      {
        id: 's4',
        kind: 'command',
        prompt: 'claude',
        task: 'Запусти тесты прямо из Claude Code в bash-режиме, не выходя из сессии.',
        accept: ['!\\s*npm test'],
        example: '!npm test',
        hints: ['Bash-режим включается одним символом в начале строки.', 'Восклицательный знак, затем команда.'],
        output: [{ text: 'Tests: 12 passed, 12 total', style: 'code' }],
        explain: 'Строка, начинающаяся с !, уходит прямо в оболочку.',
      },
      {
        id: 's5',
        kind: 'choice',
        style: 'permission',
        task: 'Claude хочет удалить старый кеш весов. Откажи — кеш ещё нужен.',
        context: [
          { text: 'Кеш весов устарел, удалю его.', style: 'claude' },
        ],
        permission: {
          tool: 'Bash command',
          description: 'Remove the stale scales cache',
          command: 'rm -rf .cache/scales',
          note: 'This command requires approval',
        },
        question: 'Do you want to proceed?',
        options: [
          { label: 'Yes', reply: 'Кеш удалён, а он был нужен.' },
          { label: "Yes, and don't ask again for: rm -rf *", reply: 'Опасно: такое правило разрешит любое удаление.' },
          { label: 'No', correct: true, esc: true, reply: 'Правильно: кеш остаётся.' },
        ],
        hints: ['Нужно отказать.', 'Esc в этом диалоге — тоже «No».'],
      },
    ],
  },
};

const longTerminal: LevelLessons['terminals'][number] = {
  id: 't2',
  title: 'Табло с очень длинным названием терминала',
  required: true,
  requires: ['t1'],
  challenge: {
    title: 'Длинные тексты',
    brief: `${LONG}. Бриф может занимать несколько строк, и панель задачи должна аккуратно переносить слова.`,
    cwd: '~/city/market/very/deeply/nested/project/directory/for-wrapping-tests',
    unlocks: ['mock-files-claude-md'],
    steps: [
      {
        id: 's1',
        kind: 'command',
        prompt: 'shell',
        task: `${LONG}. Запусти Claude Code в этой папке — задача сформулирована длинно, чтобы проверить перенос на узких экранах.`,
        accept: ['claude'],
        example: 'claude',
        hints: [
          `${LONG}. Первая подсказка тоже длинная, чтобы проверить вёрстку блока подсказок.`,
          'Шесть букв, строчными.',
        ],
        output: [{ text: 'Сессия открыта.', style: 'dim' }],
      },
      {
        id: 's2',
        kind: 'command',
        prompt: 'claude',
        task: 'Попроси Claude объяснить, почему табло показывает вчерашние цены.',
        accept: ['.{8,}'],
        example: 'почему табло показывает вчерашние цены?',
        hints: ['Пиши обычными словами.', 'Например: «почему табло показывает вчерашние цены?»'],
        output: [
          { text: 'Grep("updatedAt", src/board)', style: 'tool' },
          { text: 'Found 3 files', style: 'result' },
          { text: 'src/board/cache.ts', style: 'result' },
          { text: 'src/board/render.ts', style: 'result' },
          {
            text: 'Табло берёт цены из кеша, а кеш обновляется раз в сутки. Это видно в `src/board/cache.ts`: срок жизни записи — 24 часа, и после полуночи старые значения остаются до следующего обхода.',
            style: 'claude',
          },
          { text: 'Могу сократить срок до пяти минут.', style: 'claude' },
        ],
        explain: 'Длинный ответ Claude переносится по словам и остаётся под маркером ●.',
      },
    ],
  },
};

function meta(title: string, subtitle: string, topics: string[]): LevelMeta {
  return {
    title,
    subtitle,
    topics,
    intro: [
      `${title} давно не видел света. Здесь всё работает через терминалы, и почти все они молчат.`,
      'Почини терминалы, поговори с жителями и открой ворота в следующий район.',
    ],
    outro: [`${title} снова в строю. Жители говорят, что давно не видели такой ровной работы.`],
  };
}

function simpleLessons(prefix: string, codexId: string): LevelLessons {
  return {
    terminals: [
      {
        id: 't1',
        title: `${prefix}: пульт`,
        required: true,
        challenge: {
          title: 'Пульт',
          brief: 'Пульт молчит.',
          cwd: '~/city/console',
          unlocks: [codexId],
          steps: [
            {
              id: 's1',
              kind: 'command',
              prompt: 'claude',
              task: 'Попроси Claude проверить пульт.',
              accept: ['.{8,}'],
              example: 'проверь пульт, пожалуйста',
              hints: ['Обычными словами.', 'Например: «проверь пульт».'],
              output: [{ text: 'Пульт исправен.', style: 'claude' }],
            },
          ],
        },
      },
      {
        id: 't2',
        title: `${prefix}: щиток`,
        required: false,
        challenge: {
          title: 'Щиток',
          brief: 'Необязательный щиток.',
          cwd: '~/city/panel',
          unlocks: [],
          steps: [
            {
              id: 's1',
              kind: 'command',
              prompt: 'claude',
              task: 'Спроси, что с щитком.',
              accept: ['.{8,}'],
              example: 'что с щитком?',
              hints: ['Обычными словами.', 'Например: «что с щитком?»'],
            },
          ],
        },
      },
    ],
    npcs: [],
    chips: [{ id: 'c1', title: 'Чип', text: 'Короткий совет.' }],
    zones: [],
  };
}

/** Ids carry a `mock-` prefix so they never shadow real entries; `level` is the mock district (2…5, see mockContent). */
const MOCK_CODEX: CodexEntry[] = [
  {
    id: 'mock-cli-print',
    category: 'cli',
    title: 'claude -p',
    syntax: 'claude -p "объясни этот проект" --output-format json',
    summary: 'Один запрос без интерактивной сессии: ответ печатается и программа завершается.',
    details:
      'Удобно в скриптах и CI: вывод можно передать дальше по конвейеру.\n\nФормат вывода задаётся флагом --output-format (text, json, stream-json).',
    level: 2,
  },
  {
    id: 'mock-cli-continue',
    category: 'cli',
    title: 'claude -c',
    syntax: 'claude -c',
    summary: 'Продолжает последнюю сессию в этой папке.',
    level: 2,
  },
  {
    id: 'mock-keys-shift-tab',
    category: 'keys',
    title: 'Shift+Tab',
    syntax: 'Shift+Tab',
    summary: 'Переключает режим разрешений по кругу: auto → manual → accept edits → plan.',
    details: 'Текущий режим показан в строке состояния под полем ввода.',
    level: 2,
  },
  {
    id: 'mock-keys-esc-esc',
    category: 'keys',
    title: 'Esc Esc',
    syntax: 'Esc Esc',
    summary: 'Открывает перемотку: можно вернуться к прошлому сообщению.',
    level: 3,
  },
  {
    id: 'mock-concept-plan',
    category: 'concepts',
    title: 'Режим планирования',
    summary: 'Claude читает и составляет план, но ничего не меняет, пока ты не согласишься.',
    details:
      'Полезно перед большими правками: план можно обсудить и поправить.\n\nВключается через Shift+Tab или командой /plan.',
    level: 2,
  },
  {
    id: 'mock-concept-permissions',
    category: 'concepts',
    title: 'Разрешения',
    summary: 'Перед опасными действиями Claude спрашивает разрешение: один раз, всегда или нет.',
    level: 3,
  },
  {
    id: 'mock-files-claude-md',
    category: 'files',
    title: 'CLAUDE.md',
    syntax: './CLAUDE.md',
    summary: 'Памятка проекта: загружается в начале каждой сессии.',
    details: 'Пиши туда команды сборки, правила стиля и устройство проекта. Коротко и по делу.',
    level: 2,
  },
  {
    id: 'mock-files-settings',
    category: 'files',
    title: '.claude/settings.json',
    syntax: '.claude/settings.json',
    summary: 'Настройки проекта: разрешения, хуки, переменные окружения.',
    level: 4,
  },
  {
    id: 'mock-slash-compact',
    category: 'slash',
    title: '/compact',
    syntax: '/compact [инструкции]',
    summary: 'Сжимает историю разговора, чтобы освободить контекст.',
    level: 4,
  },
  {
    id: 'mock-slash-clear',
    category: 'slash',
    title: '/clear',
    syntax: '/clear',
    summary: 'Начинает разговор с чистого листа.',
    level: 4,
  },
  {
    id: 'mock-slash-model',
    category: 'slash',
    title: '/model',
    syntax: '/model',
    summary: 'Выбирает модель для сессии.',
    level: 5,
  },
  {
    id: 'mock-concept-context',
    category: 'concepts',
    title: 'Контекстное окно',
    summary: 'Всё, что Claude держит в голове за сессию: файлы, сообщения, вывод команд.',
    level: 5,
  },
];

/**
 * The real content plus four mock districts after the real ones: ids m2…m5 (never a real level id, so
 * `levels.find` and the level list stay unambiguous), indexes after the last real level.
 */
export function mockContent(base: UIContent): UIContent {
  const l1 = base.levels[0];
  if (!l1) return base;
  const layout = l1.layout;
  /** Index of mock district n (2…5): right after the real levels. */
  const index = (n: number) => Math.max(0, ...base.levels.map((l) => l.index)) + n - 1;
  const levels: LevelDef[] = [
    ...base.levels,
    {
      id: 'm2',
      index: index(2),
      meta: meta('Рынок Контекста', 'Режимы, планы и bash-режим', ['Shift+Tab и режимы', 'Режим планирования', 'Bash-режим через !']),
      lessons: {
        terminals: [showcase, longTerminal],
        npcs: [
          {
            id: 'n1',
            name: 'Торговка Лиса',
            model: 'npc_round',
            tint: '#ffcf5a',
            dialogs: [
              {
                lines: [
                  { text: 'Весы опять врут! А покупатели ругаются уже третий день подряд.', mood: 'worried' },
                  { text: 'Сейчас посмотрю.', speaker: 'ХАРНИ', mood: 'thinking' },
                  { text: `${LONG}. Это реплика подлиннее, чтобы проверить перенос в окне диалога и высоту блока.`, mood: 'neutral' },
                  { text: 'Вот это да!', mood: 'excited' },
                ],
              },
            ],
          },
        ],
        chips: [
          {
            id: 'c1',
            title: 'Чип: bash-режим',
            text: 'Строка, начинающаяся с !, выполняется прямо в оболочке, не выходя из Claude Code. Удобно для быстрых проверок: тесты, git status, ls.',
            unlocks: ['mock-cli-continue'],
          },
        ],
        zones: [],
      },
      layout,
    },
    {
      id: 'm3',
      index: index(3),
      meta: meta('Депо Разрешений и Очень Длинных Названий Районов', 'Права, отказы и перемотка истории', [
        'Диалог разрешений',
        'Esc Esc и перемотка',
        LONG,
      ]),
      lessons: simpleLessons('Депо', 'mock-concept-permissions'),
      layout,
    },
    { id: 'm4', index: index(4), meta: meta('Башня Настроек', 'settings.json и /compact', ['settings.json', '/compact', '/clear']), lessons: simpleLessons('Башня', 'mock-files-settings'), layout },
    { id: 'm5', index: index(5), meta: meta('Ядро', 'Модели и контекст', ['/model', 'Контекст']), lessons: simpleLessons('Ядро', 'mock-slash-model'), layout },
  ];
  const codex = MOCK_CODEX.map((e) => ({ ...e, level: index(e.level) }));
  return { levels, codex: [...base.codex, ...codex] };
}
