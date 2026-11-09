"""Образец для перевода: все универсальные конструкции.
Многострочная строка документации."""
import sys


class ОшибкаВвода(Exception):
    def __init__(self, text):
        super().__init__(text)


class Фигура:
    создано = 0

    def __init__(self, имя):
        self.имя = имя
        self.__тайна = 7

    @staticmethod
    def описание():
        return "фигура"

    @property
    def длинное_имя(self):
        return "фигура " + self.имя

    def площадь(self):
        return 0

    def __str__(self):
        return "Фигура(" + self.имя + ")"


class Квадрат(Фигура):
    def __init__(self, сторона):
        super().__init__("квадрат")
        self.сторона = сторона

    def площадь(self):
        return self.сторона * self.сторона


def проверить(x):
    """Строка документации функции."""
    if x < 0:
        raise ОшибкаВвода("отрицательное")
    if x == 0:
        raise ValueError("ноль")
    return 10 // x


a, b = 1, 2
a, b = b, a
print(a, b)
к = Квадрат(3)
print(к.площадь(), к.длинное_имя, Фигура.описание(), isinstance(к, Фигура), isinstance(5, int))
print(к)
for v in [-1, 0, 3]:
    try:
        print(проверить(v))
    except ОшибкаВвода as e:
        print("ввод", e)
    except ValueError as e:
        print("значение", e)
м = {1, 2, 2, 3}
print(len(м), 2 in м)
print(6 & 3, 6 | 1, 6 ^ 3, 1 << 4, 256 >> 2, ~0, -7 // 2)
x = 5
x <<= 1
x |= 1
print(x)
for i, буква in enumerate("аб"):
    print(i, буква)
for p, q in zip([1, 2], "xy"):
    print(p, q)
print(chr(1046), ord("Ж"))
d = {"a": 1, "b": 2}
del d["a"]
print(d)
assert x > 0, "не должно упасть"
print(any(n > 2 for n in [1, 3]), all(n > 2 for n in [1, 3]))
print("в поток ошибок", file=sys.stderr)
sys.exit(0)
print("не печатается")
