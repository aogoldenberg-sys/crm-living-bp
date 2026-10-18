#!/usr/bin/env python3
"""
Импорт прайсов поставщиков из Google Sheets → Firestore
tenants/gustoriko/pricelist_items

Запуск: python3 import_pricelist.py
"""
import csv, io, re, urllib.request, urllib.parse, datetime, sys, time, ssl

import firebase_admin
from firebase_admin import credentials, firestore

# ── Конфиг ───────────────────────────────────────────────────────────────────

SA_KEY   = "/Users/annagranenova/Downloads/It/crm-living-bp-firebase-adminsdk-fbsvc-c53d9c7dbd.json"
SHEET_ID = "1BqrvyxXYUDT-wmBC0RR1Xnz_29hPIn6FNgrMFKhs-uA"
BUSINESS = "gustoriko"

# Лист → (supplierId, supplierName)
SHEETS = [
    ("консервы рыба-мясо",                        "fish_meat",   "Консервы рыба-мясо"),
    ("ApexFood — Бакалея, кондитерские изделия",  "apexfood",    "ApexFood"),
    ("Eurotrade24 — Импортные снеки, печенье",    "eurotrade24", "Eurotrade24"),
    ("Аксиома — Бакалея, специи",                 "axioma",      "Аксиома"),
    ("Байкал — Минеральная вода",                 "baykal",      "Байкал"),
    ("Бочкарев — Пиво",                           "bockarev",    "Бочкарев"),
    ("ИнтерФуд Групп — Сыры, морепродукты",       "ifg",         "ИнтерФуд Групп"),
    ("Курский МЗ — Масло, молочная продукция",    "kurskiy",     "Курский МЗ"),
    ("Кэнди Фрут — Сахарная вата, сладости",      "candyfruit",  "Кэнди Фрут"),
    ("Метро — Бакалея, напитки, FMCG",            "metro",       "Метро"),
    ("Молтрейд — Молочная продукция",             "moltreid",    "Молтрейд"),
    ("Мултон — Соки, воды, напитки",              "multon",      "Мултон"),
    ("Первым Делом — Бакалея, хлебцы",            "pervym",      "Первым Делом"),
    ("Пик пак сыр — Сыры",                        "pikpak",      "Пик пак"),
    ("Профитс — Оливки, маслины, консервация",    "profits",     "Профитс"),
    ("Скорпинский — Тушёнка, консервы",           "skopinsky",   "Скопинский"),
    ("ТД Орион — Азиатские соусы и лапша",        "tdorion",     "ТД Орион"),
    ("Тандер — Мультикатегорийный прайс",         "tander",      "Тандер"),
    ("Черноголовка — Газированные напитки",       "chernog",     "Черноголовка"),
    ("Ашкуди Энерджи — Энергетические напитки",   "ashkudi",     "Ашкуди"),
    ("РОТФРОНТ — Кондитерские изделия",           "rotfront",    "РОТФРОНТ"),
    ("IFG — Крабовые палочки, сыры",              "ifg2",        "IFG"),
    ("Тушёнка (сводный) — Консервы",              "tushenka",    "Тушёнка сводный"),
    ("ЛетоК — Сухофрукты, замороженные продукты", "letok",       "ЛетоК"),
    ("PepsiCo — Напитки, снеки",                  "pepsico",     "PepsiCo"),
    ("ТД Продвей — Доширак, Акульчев и др.",      "tdprodvey",   "ТД Продвей"),
    ("А10 — Консервы, мясо, тушёнка",             "a10",         "А10"),
    ("КРУТОТЕСТОВО — Кондитерские изделия",       "krutotestovo","КРУТОТЕСТОВО"),
    ("Северный берег — Оливковое масло",          "sevbereg",    "Северный берег"),
    ("Птицефабрика Сеймовская — Мясо, колбасы",  "seymovskaya", "Птицефабрика Сеймовская"),
]

# ── Нормализация ──────────────────────────────────────────────────────────────

def norm(s: str) -> str:
    """Убирает мусор, приводит к нижнему регистру для поиска колонки."""
    return re.sub(r'\s+', ' ', s.strip().lower())

def find_col(headers: list[str], keywords: list[str]) -> int | None:
    """Возвращает индекс первой колонки, содержащей одно из ключевых слов."""
    for kw in keywords:
        for i, h in enumerate(headers):
            if kw in norm(h):
                return i
    return None

def parse_price(s: str) -> int | None:
    """'236,3' или '236.3' → 23630 копеек. None если не число."""
    s = s.strip().replace('\xa0', '').replace(' ', '').replace(',', '.')
    # Берём первое число если в ячейке несколько (ApexFood-style)
    m = re.search(r'\d[\d.]*', s)
    if not m:
        return None
    try:
        return round(float(m.group()) * 100)
    except ValueError:
        return None

def fetch_csv(sheet_name: str) -> list[list[str]]:
    """Загружает лист как CSV через gviz/tq."""
    url = (
        f"https://docs.google.com/spreadsheets/d/{SHEET_ID}"
        f"/gviz/tq?tqx=out:csv&sheet={urllib.parse.quote(sheet_name)}"
    )
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30, context=ctx) as r:
        text = r.read().decode("utf-8")
    return list(csv.reader(io.StringIO(text)))

def parse_sheet(rows: list[list[str]], supplier_id: str, supplier_name: str) -> list[dict]:
    """Парсит строки в список документов pricelist_items."""
    if not rows:
        return []

    # Заголовок — первая строка
    headers = rows[0]
    i_barcode  = find_col(headers, ["штрихкод", "шк продукции", "barcode", "ean"])
    i_name     = find_col(headers, ["наименование", "название", "товар", "name"])
    i_sku      = find_col(headers, ["артикул", "арт", "sku", "article"])
    i_quant    = find_col(headers, ["квант", "кол-во", "упак", "quantity"])
    i_price    = find_col(headers, ["цена", "price"])
    i_note     = find_col(headers, ["примечание", "категория", "note", "остаток"])

    if i_name is None or i_price is None:
        print(f"  ⚠️  пропуск — не найдены колонки name/price в {headers[:3]}")
        return []

    items = []
    now = datetime.datetime.utcnow().isoformat() + "Z"

    for row in rows[1:]:
        if len(row) <= max(filter(lambda x: x is not None, [i_name, i_price])):
            continue
        name = row[i_name].strip() if i_name is not None else ""
        if not name or name.lower() in ("наименование", "название"):
            continue  # пустая или повторный заголовок

        price_str = row[i_price].strip() if i_price is not None and i_price < len(row) else ""
        price_kop = parse_price(price_str)
        if price_kop is None or price_kop <= 0:
            continue  # нет цены — пропускаем

        barcode = (row[i_barcode].strip() if i_barcode is not None and i_barcode < len(row) else "") or None
        sku     = (row[i_sku].strip()     if i_sku     is not None and i_sku     < len(row) else "") or None
        quant   = (row[i_quant].strip()   if i_quant   is not None and i_quant   < len(row) else "") or None
        note    = (row[i_note].strip()    if i_note    is not None and i_note    < len(row) else "") or None

        # Нормализуем квант в число
        quant_n = None
        if quant:
            m = re.search(r'\d+', quant)
            if m:
                quant_n = int(m.group())

        items.append({
            "supplierId":    supplier_id,
            "supplierName":  supplier_name,
            "productName":   name,
            "barcode":       barcode,
            "sku":           sku,
            "priceKopecks":  price_kop,
            "quant":         quant_n,
            "note":          note,
            "updatedAt":     now,
        })

    return items

# ── Firestore batch write ─────────────────────────────────────────────────────

def write_to_firestore(db, items: list[dict], supplier_id: str):
    col = db.collection(f"tenants/{BUSINESS}/pricelist_items")

    # Удаляем старые записи этого поставщика
    old = col.where("supplierId", "==", supplier_id).stream()
    deleted = 0
    batch = db.batch()
    for i, doc in enumerate(old):
        batch.delete(doc.reference)
        deleted += 1
        if (i + 1) % 499 == 0:
            batch.commit()
            batch = db.batch()
    batch.commit()
    if deleted:
        print(f"  🗑  удалено {deleted} старых записей")

    # Пишем новые батчами по 499
    batch = db.batch()
    written = 0
    for i, item in enumerate(items):
        ref = col.document()
        batch.set(ref, item)
        written += 1
        if written % 499 == 0:
            batch.commit()
            batch = db.batch()
            time.sleep(0.3)   # не давить квоту
    batch.commit()
    return written

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    cred = credentials.Certificate(SA_KEY)
    firebase_admin.initialize_app(cred)
    db = firestore.client()

    # Фильтр: если передан аргумент — импортируем только его
    filter_id = sys.argv[1] if len(sys.argv) > 1 else None

    total = 0
    for sheet_name, supplier_id, supplier_name in SHEETS:
        if filter_id and supplier_id != filter_id:
            continue

        print(f"\n📦 {supplier_name} ({supplier_id})")
        try:
            rows = fetch_csv(sheet_name)
            print(f"  загружено {len(rows) - 1} строк")
        except Exception as e:
            print(f"  ❌ ошибка загрузки: {e}")
            continue

        items = parse_sheet(rows, supplier_id, supplier_name)
        print(f"  распознано {len(items)} товаров")

        if not items:
            continue

        try:
            written = write_to_firestore(db, items, supplier_id)
            print(f"  ✅ записано {written} в Firestore")
            total += written
        except Exception as e:
            print(f"  ❌ ошибка записи: {e}")

    print(f"\n{'='*40}")
    print(f"Итого записано: {total} позиций")

if __name__ == "__main__":
    main()
