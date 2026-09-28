/*
 * Сборка одного автономного HTML-файла из src/ с поддержкой старых браузеров.
 *
 *   npm i --prefix /tmp/lc-build @babel/core @babel/preset-env acorn
 *   NODE_PATH=/tmp/lc-build/node_modules node loss-calculator/build.cjs
 *
 * Что делает:
 *  - переводит JavaScript в ES5 (Babel, цель — IE 11) и встраивает его в страницу;
 *  - добавляет полифилы (src/polyfills.js);
 *  - перед каждым свойством с var(--…) вставляет то же свойство со светлым значением —
 *    браузеры без CSS-переменных берут его, остальные его перекрывают;
 *  - проверяет парсером, что во встроенных скриптах остался только синтаксис ES5.
 */
const fs = require('fs');
const path = require('path');
const babel = require('@babel/core');
const presetEnv = require('@babel/preset-env');
const acorn = require('acorn');

const SRC = path.join(__dirname, 'src');
const OUT = path.join(__dirname, 'raschet-poter.html');

const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');

function toES5(code, name) {
  const res = babel.transformSync(code, {
    filename: name,
    babelrc: false,
    configFile: false,
    sourceType: 'script',
    compact: false,
    comments: false,
    presets: [[presetEnv, { targets: { ie: '11' }, modules: false }]],
    assumptions: { iterableIsArray: true, noDocumentAll: true, setSpreadProperties: true, ignoreToPrimitiveHint: true },
  });
  return res.code;
}

function assertES5(code, name) {
  try {
    acorn.parse(code, { ecmaVersion: 5, sourceType: 'script' });
  } catch (e) {
    const line = code.split('\n')[e.loc.line - 1] || '';
    throw new Error(`${name}: синтаксис новее ES5 (${e.message}): ${line.trim().slice(0, 120)}`);
  }
}

function cssFallbacks(css) {
  const root = css.match(/:root\s*\{([^}]*)\}/);
  if (!root) throw new Error('Не найден блок :root с переменными');
  const vars = {};
  root[1].replace(/(--[\w-]+)\s*:\s*([^;]+);/g, (m, k, v) => { vars[k] = v.trim(); return m; });
  const resolve = (v) => v.replace(/var\((--[\w-]+)(?:\s*,\s*([^)]+))?\)/g, (m, k, fb) => {
    if (vars[k] != null) return vars[k];
    if (fb != null) return fb.trim();
    throw new Error(`Нет значения для ${k}`);
  });
  return css.replace(/(^|[;{\s])([a-z][a-z-]*)\s*:\s*([^;{}]*var\(--[^;{}]*?)(\s*)(?=;|})/g,
    (m, pre, prop, val, ws) => `${pre}${prop}: ${resolve(val)}; ${prop}: ${val}${ws}`);
}

let html = read('index.html');

// CSS
html = html.replace(/<style>([\s\S]*?)<\/style>/, (m, css) => `<style>${cssFallbacks(css)}</style>`);

// Скрипты: внешние файлы и встроенный код приложения
const inline = (code, name) => {
  assertES5(code, name);
  if (/<\/script/i.test(code)) throw new Error(`${name}: содержит </script>`);
  return `<script>\n${code}\n</script>`;
};
// сначала код приложения (последний <script> перед </body>), затем внешние файлы
html = html.replace(/<script>\n((?:(?!<script)[\s\S])*?)<\/script>\n<\/body>/, (m, code) => `${inline(toES5(code, 'app'), 'app')}\n</body>`);
html = html.replace('<script src="polyfills.js"></script>', () => inline(read('polyfills.js'), 'polyfills.js'));
html = html.replace('<script src="calc.js"></script>', () => inline(toES5(read('calc.js'), 'calc.js'), 'calc.js'));

if (/<script src=/.test(html)) throw new Error('Остались внешние скрипты');

const stamp = `<!-- Собрано из loss-calculator/src скриптом build.cjs. Правьте исходники в src/ и пересобирайте. -->\n`;
html = html.replace('<!doctype html>\n', `<!doctype html>\n${stamp}`);
fs.writeFileSync(OUT, html);
console.log(`Готово: ${path.relative(process.cwd(), OUT)} (${Math.round(html.length / 1024)} КБ)`);
