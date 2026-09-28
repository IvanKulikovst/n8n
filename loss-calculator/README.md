# Расчёт прогнозируемых потерь БТВТ и АТ

**`raschet-poter.html`** — готовый калькулятор в одном файле. Не требует интернета и других файлов:
достаточно открыть в браузере или передать файл. Работает в Internet Explorer 11, старом Edge,
Chrome/Firefox 2015+ и Safari 9+, а также в современных браузерах.

Файл собирается из исходников в `src/`; вручную его не правят.

| Путь | Назначение |
|---|---|
| `raschet-poter.html` | Собранный калькулятор (один файл, ES5 + полифилы). |
| `src/index.html` | Исходник страницы (разметка, стили, код интерфейса). |
| `src/calc.js` | Расчётное ядро без интерфейса (браузер и Node.js). |
| `src/polyfills.js` | Полифилы для старых браузеров. |
| `src/calc.test.cjs` | Тесты ядра: `node --test loss-calculator/src/calc.test.cjs`. |
| `build.cjs` | Сборка `raschet-poter.html`. |
| `loss_calc.py` | Исправленная консольная версия: `python3 loss_calc.py [--example]`. |

## Сборка

```sh
npm i --prefix /tmp/lc-build @babel/core @babel/preset-env acorn
NODE_PATH=/tmp/lc-build/node_modules node loss-calculator/build.cjs
```

Скрипт переводит JavaScript в ES5 (Babel, цель IE 11), встраивает полифилы и ядро, добавляет
к стилям значения без CSS-переменных и проверяет парсером, что в файле остался только синтаксис ES5.
