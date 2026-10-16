import math
def fact(n):
    if n <= 1:
        return 1
    return n * fact(n - 1)

class Animal:
    def __init__(self, name):
        self.name = name
    def speak(self):
        return f"{self.name} молчит"

class Cat(Animal):
    def speak(self):
        return f"{self.name} мяукает"

nums = [3, 1, 2]
nums.append(10)
total = 0
for x in nums:
    total += x
print("Сумма:", total, len(nums))
for i in range(1, 10, 3):
    print(i, fact(i))
d = {"a": 1, "b": 2}
for k, v in d.items():
    print(f"{k} -> {v}")
if total > 100:
    res = "много"
elif total > 10:
    res = "средне"
else:
    res = "мало"
print(res)
squares = [y * y for y in nums if y > 1]
print(squares)
c = Cat("Барсик")
print(c.speak(), Animal("Тень").speak())
try:
    raise ValueError("беда")
except ValueError as e:
    print("Ошибка:", str(e))
i = 0
while True:
    i += 1
    if i == 3:
        break
print(i, "ok" if i == 3 else "no", "Привет".upper(), ", ".join(["a", "b"]))
