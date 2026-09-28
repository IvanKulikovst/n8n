"""Расчёт прогнозируемых потерь БТВТ и АТ за сутки боя (методика главы 2).

Исправленная версия исходной программы:
  * K_м зависит от группы: 1,25 для БТВТ и 1,15 для АТ (было 1,25 для всех);
  * прогноз в единицах не округляется до целого (было round() -> 0 ед. для 13 БТР);
  * считаются единицы по каждому виду (БП, КР, СР, ТР) и общий выход N_ВВСТ;
  * добавлена оценка ремонтных возможностей K_c = Q / N_ВВСТ (п. 2.7);
  * K(t) — коэффициент продолжительности операции (табл. 2), а не «воздействия противника».

Запуск: python3 loss_calc.py            — ввод данных с клавиатуры
        python3 loss_calc.py --example  — пример п. 2.5
"""

import sys
from decimal import Decimal, ROUND_HALF_UP

KINDS = [("БП", "Безвозвратные потери"), ("КР", "Капитальный ремонт"),
         ("СР", "Средний ремонт"), ("ТР", "Текущий ремонт")]

# Таблица 1 — нормы среднесуточных потерь, %: БП, КР, СР, ТР
NORMS = {
    "БТВТ": {
        "Танки": (2.0, 1.2, 2.2, 2.8),
        "БМП": (1.6, 1.0, 1.6, 2.6),
        "БТР": (0.9, 0.7, 1.0, 1.9),
        "Разведывательные машины": (1.3, 1.0, 1.3, 2.4),
        "КШМ": (1.3, 1.0, 1.3, 2.4),
        "Тягачи танковые": (0.44, 0.33, 1.1, 1.5),  # СР, вероятно, 0,44 — сверить с первоисточником
    },
    "АТ": {
        "Автомобили общего назначения": (0.9, 0.6, 0.8, 4.0),
        "Автомобили специальные": (1.2, 0.8, 1.0, 4.5),
        "Грузовые автомобили": (1.3, 1.1, 1.2, 5.0),
        "Автомобили под монтаж вооружения": (1.6, 1.2, 1.3, 6.5),
    },
}

# Таблица 2 — K(t): сутки -> (оборона, наступление)
KT = {10: (1.72, 1.44), 15: (1.60, 1.32), 20: (1.40, 1.18), 25: (1.26, 1.05), 30: (1.16, 1.00),
      35: (1.10, 1.00), 40: (1.05, 1.00), 45: (1.00, 1.00), 50: (0.95, 0.95)}

# Таблица 3 — K_зс: (оборона, наступление) -> (мин, макс)
KZS = {
    "В 1-м эшелоне": ((1.25, 1.35), (1.35, 1.45)),
    "На других направлениях": ((0.8, 0.9), (0.85, 0.95)),
    "Во 2-м эшелоне": ((0.3, 0.4), (0.35, 0.45)),
}

# Таблица 4 — K_рб: (подготовленный, неподготовленный рубеж)
KRB = {
    "Бронетанковое вооружение и техника": (1.1, 1.3),
    "Артиллерийское вооружение": (1.0, 1.5),
    "Средства боевого обеспечения": (1.0, 1.2),
    "Средства МТО": (1.0, 1.2),
}

KM_UTG = {"БТВТ": 1.25, "АТ": 1.15}  # п. 2.3.4


def round_half_up(x, digits):
    """Округление «как на бумаге»: 0,55 -> 0,6 (встроенный round даёт банковское)."""
    q = Decimal(1).scaleb(-digits)
    return float(Decimal(repr(x)).quantize(q, rounding=ROUND_HALF_UP))


def fmt(x, digits=None):
    if digits is None:
        s = f"{round_half_up(x, 4):.4f}".rstrip("0").rstrip(".")
    else:
        s = f"{round_half_up(x, digits):.{digits}f}"
    return s.replace(".", ",")


def k_t(days, offensive):
    """K(t) по табл. 2 с линейной интерполяцией между строками."""
    col = 1 if offensive else 0
    keys = sorted(KT)
    if days <= keys[0]:
        return KT[keys[0]][col]
    if days >= keys[-1]:
        return KT[keys[-1]][col]
    for d0, d1 in zip(keys, keys[1:]):
        if d0 <= days <= d1:
            k0, k1 = KT[d0][col], KT[d1][col]
            return round_half_up(k0 + (k1 - k0) * (days - d0) / (d1 - d0), 3)
    return 1.0


def calc_group(rows, kt, kzs, krb, km, round_pct=True, n_digits=None):
    """rows: [(название, N_сп, (БП, КР, СР, ТР))]. Возвращает проценты и единицы по видам."""
    factor = kt * kzs * krb * km
    result = []
    total = 0.0
    for name, count, norms in rows:
        p = [n * factor for n in norms]
        if round_pct:
            p = [round_half_up(x, 1) for x in p]
        n = [count * x / 100 for x in p]
        if n_digits is not None:
            n = [round_half_up(x, n_digits) for x in n]
        result.append({"name": name, "count": count, "p": p, "n": n})
        total += sum(n)
    return factor, result, total


def read_float(prompt, default=None):
    while True:
        raw = input(prompt + (f" [{fmt(default)}]" if default is not None else "") + ": ").strip()
        if not raw and default is not None:
            return default
        try:
            return float(raw.replace(",", "."))
        except ValueError:
            print("  Ошибка: введите число.")


def choose(prompt, options):
    names = list(options)
    for i, name in enumerate(names, 1):
        print(f"  {i}. {name}")
    while True:
        raw = input(f"{prompt} (номер): ").strip()
        if raw.isdigit() and 1 <= int(raw) <= len(names):
            return names[int(raw) - 1]
        print("  Ошибка: введите номер из списка.")


def read_rows(group):
    rows = []
    print(f"\nТехника группы {group} (пустой ввод количества — закончить):")
    while True:
        name = choose("Вид ВВСТ", NORMS[group])
        count = read_float("Списочный состав, ед.", 0)
        if count <= 0:
            break
        rows.append((name, count, NORMS[group][name]))
        if input("Добавить ещё вид? (д/н): ").strip().lower() not in ("д", "y", "да"):
            break
    return rows


def ask_input():
    print("=== Расчёт прогнозируемых потерь БТВТ и АТ за сутки боя ===\n")
    offensive = choose("Характер действий", ["Оборонительные", "Наступательные"]) == "Наступательные"
    days = read_float("Продолжительность операции, сут.", 45)
    echelon = choose("Элемент оперативного построения", KZS)
    lo, hi = KZS[echelon][1 if offensive else 0]
    kzs = read_float(f"K_зс (диапазон {fmt(lo)}–{fmt(hi)})", hi)
    if not lo <= kzs <= hi:
        print(f"  Внимание: K_зс вне диапазона табл. 3 ({fmt(lo)}–{fmt(hi)}).")
    prepared = choose("Разновидность боя", ["Подготовленный рубеж", "Неподготовленный рубеж"]) == "Подготовленный рубеж"
    utg = input("Масштаб УТГ? (д/н) [д]: ").strip().lower() in ("", "д", "y", "да")
    groups = {}
    for g, krb_default in (("БТВТ", "Бронетанковое вооружение и техника"), ("АТ", "Средства МТО")):
        rows = read_rows(g)
        if rows:
            print(f"Строка табл. 4 для K_рб группы {g}:")
            krb_row = choose("Строка", KRB)
        else:
            krb_row = krb_default
        groups[g] = (rows, krb_row)
    q_raw = input("Q — возможности по ремонту, ед./сут. (пусто — не оценивать): ").strip()
    q = float(q_raw.replace(",", ".")) if q_raw else None
    return dict(offensive=offensive, days=days, kzs=kzs, prepared=prepared, utg=utg, groups=groups, q=q, n_digits=None)


def example_input():
    """Пример п. 2.5 (в методичке K_рб = 1,1 взят и для АТ; единицы округлены: БТВТ до 0,01, АТ до 0,1)."""
    return dict(
        offensive=False, days=45, kzs=0.4, prepared=True, utg=True, q=None,
        groups={
            "БТВТ": ([("БТР", 13, NORMS["БТВТ"]["БТР"])], "Бронетанковое вооружение и техника"),
            "АТ": ([("Автомобили общего назначения", 96, NORMS["АТ"]["Автомобили общего назначения"])],
                   "Бронетанковое вооружение и техника"),
        },
        n_digits={"БТВТ": 2, "АТ": 1},
    )


def run(data):
    kt = k_t(data["days"], data["offensive"])
    total = 0.0
    kinds_sum = [0.0] * 4
    print("\n--- Результаты расчёта ---")
    print(f"K(t) = {fmt(kt)}; K_зс = {fmt(data['kzs'])}")
    for g, (rows, krb_row) in data["groups"].items():
        if not rows:
            continue
        krb = KRB[krb_row][0 if data["prepared"] else 1]
        km = KM_UTG[g] if data["utg"] else 1.0
        digits = (data["n_digits"] or {}).get(g)
        factor, res, g_total = calc_group(rows, kt, data["kzs"], krb, km, True, digits)
        print(f"\n{g}: K_рб = {fmt(krb)} ({krb_row}), K_м = {fmt(km)}, произведение коэффициентов {fmt(factor)}")
        for r in res:
            print(f"  {r['name']} — {fmt(r['count'])} ед.")
            for (short, name), p, n in zip(KINDS, r["p"], r["n"]):
                print(f"    {name} ({short}): {fmt(p, 1)} % -> {fmt(n)} ед./сут.")
            print(f"    Всего: {fmt(sum(r['p']), 1)} % -> {fmt(sum(r['n']))} ед./сут.")
            kinds_sum = [a + b for a, b in zip(kinds_sum, r["n"])]
        print(f"  Совокупный выход {g}: {fmt(g_total)} ед./сут.")
        total += g_total
    print(f"\nОбщий совокупный выход ВВСТ: N_ВВСТ = {fmt(total)} ед./сут.")
    print("  в том числе " + "; ".join(f"{s} — {fmt(v)}" for (s, _), v in zip(KINDS, kinds_sum)))
    if data["q"] is not None and total > 0:
        kc = data["q"] / total
        print(f"K_c = Q / N_ВВСТ = {fmt(data['q'])} / {fmt(total)} = {fmt(kc, 2)}")
        if kc >= 1:
            print("K_c >= 1 — возможностей достаточно.")
        else:
            print(f"K_c < 1 — дефицит {fmt(total - data['q'], 2)} ед./сут., требуется усиление.")
    return total


def main():
    try:
        data = example_input() if "--example" in sys.argv else ask_input()
    except (EOFError, KeyboardInterrupt):
        print("\nВвод прерван.")
        return
    run(data)


if __name__ == "__main__":
    main()
