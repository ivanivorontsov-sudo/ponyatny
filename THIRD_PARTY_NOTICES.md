# Сторонние компоненты

| Компонент | Где используется | Лицензия |
|---|---|---|
| acorn | разбор JavaScript в переводчике и песочнице | MIT, `licenses/acorn-LICENSE.txt` |
| Node.js | среда выполнения внутри `ponyatny.exe`, `ponyatny-linux` и программ, собранных командой `собрать` | MIT и лицензии встроенных библиотек, `licenses/node-LICENSE.txt` |
| Python 3.12: heapq, bisect, statistics, colorsys, textwrap | переведены на «Понятный» и встроены в компилятор как `стд/куча`, `стд/поиск`, `стд/статистика`, `стд/цвет`, `стд/текст` | PSF License 2.0, © Python Software Foundation, `licenses/python-PSF-LICENSE.txt` |
| Easing Equations (Robert Penner) | переведены на «Понятный»: `стд/плавность` | BSD 3-Clause, `licenses/penner-easing-BSD.txt` |
| Victor.js (Max Kueng, George Crabtree) | основные методы переведены на «Понятный»: `стд/вектор` | MIT, `licenses/victor-LICENSE.txt` |

Квантовый симулятор `стд/квант`, `стд/игра`, графика (`src/grafika.js`) и iOS-оболочка (`src/ios.js`) написаны для «Понятного» с нуля; формулы вентилей и алгоритмов — стандартные из учебной литературы (Nielsen, Chuang). Для сборки под iOS на Mac используются Xcode (Apple) и XcodeGen (MIT, устанавливается отдельно через Homebrew и в проект не входит).
