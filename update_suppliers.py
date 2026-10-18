#!/usr/bin/env python3
"""
Заполняет карточки поставщиков в Firestore данными из папки и писем.
Запуск: python3 update_suppliers.py
"""
import firebase_admin
from firebase_admin import credentials, firestore

SA_KEY   = "/Users/annagranenova/Downloads/It/crm-living-bp-firebase-adminsdk-fbsvc-c53d9c7dbd.json"
BUSINESS = "gustoriko"

SHEET_ID = "1BqrvyxXYUDT-wmBC0RR1Xnz_29hPIn6FNgrMFKhs-uA"
SHEET_BASE = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/edit"

def sheet_url(sheet_name):
    from urllib.parse import quote
    return f"{SHEET_BASE}#gid=0&range=A1&sheet={quote(sheet_name)}"

# Данные собраны из: Реестр_поставщиков_Густорико.xlsx + email-файлы в папках
UPDATES = {
    "Байкал": {
        "assortment": "Байкал газ./негаз. 0,25–1л стекло/ПЭТ; BAIKAL430; Жемчужина Байкала",
        "conditions": "Наша доставка, отсрочка 14 дней",
        "sheetName": "Байкал — Минеральная вода",
        "sheetUrl":  sheet_url("Байкал — Минеральная вода"),
        "section": "current", "hasContract": False,
    },
    "Скопинский МПК": {
        "assortment": "Говядина/свинина тушёная, конина, каши с мясом, паштеты 100г, ветчина",
        "conditions": "Доставка МСК/МО бесплатно, 3–14 дней",
        "contact": "Александр",
        "sheetName": "Скорпинский — Тушёнка, консервы",
        "sheetUrl":  sheet_url("Скорпинский — Тушёнка, консервы"),
        "section": "current", "hasContract": False,
    },
    "Скопинский": {
        "assortment": "Говядина/свинина тушёная, конина, каши с мясом, паштеты 100г, ветчина",
        "conditions": "Доставка МСК/МО бесплатно, 3–14 дней",
        "contact": "Александр",
        "sheetName": "Скорпинский — Тушёнка, консервы",
        "sheetUrl":  sheet_url("Скорпинский — Тушёнка, консервы"),
        "section": "current", "hasContract": False,
    },
    "Скорпинский": {
        "assortment": "Говядина/свинина тушёная, конина, каши с мясом, паштеты 100г, ветчина",
        "conditions": "Доставка МСК/МО бесплатно, 3–14 дней",
        "sheetName": "Скорпинский — Тушёнка, консервы",
        "sheetUrl":  sheet_url("Скорпинский — Тушёнка, консервы"),
        "section": "current", "hasContract": False,
    },
    "Профитс (Русина)": {
        "assortment": "Маслины чёрные резаные/целые 3100мл; оливки зелёные 370/720/3100мл; халапеньо, перец черри",
        "conditions": "Мин. партия 6–12 шт.; штрихкоды есть",
        "sheetName": "Профитс — Оливки, маслины, консервация",
        "sheetUrl":  sheet_url("Профитс — Оливки, маслины, консервация"),
        "section": "current", "hasContract": True,
    },
    "Пик пак сыр": {
        "assortment": "Cheddar Red, Gouda, Parmezano, Mozzarella, Сыр русский — HoReCa формат",
        "conditions": "HoReCa сегмент; ШК есть (этикетки)",
        "sheetName": "Пик пак сыр — Сыры",
        "sheetUrl":  sheet_url("Пик пак сыр — Сыры"),
        "section": "current", "hasContract": False,
    },
    "Тандер": {
        "assortment": "Love is жвачка; мармелад Азовская КФ; халва; конфеты весовые; паста Отломи; Тортимилка",
        "conditions": "РЦ Тула; прайс по категориям; штрихкоды есть",
        "sheetName": "Тандер — Мультикатегорийный прайс",
        "sheetUrl":  sheet_url("Тандер — Мультикатегорийный прайс"),
        "section": "current", "hasContract": False,
    },
    "Первым Делом": {
        "assortment": "Томатная паста, хлебцы, печенье, крупы, сухофрукты — 5 264 позиции",
        "conditions": "Массовый сегмент; прайс актуален 18.09.2026",
        "sheetName": "Первым Делом — Бакалея, хлебцы",
        "sheetUrl":  sheet_url("Первым Делом — Бакалея, хлебцы"),
        "section": "current", "hasContract": False,
    },
    "ЛетоК": {
        "assortment": "Картофель кубик, брокколи, горошек, шпинат, шампиньоны, клубника, ягодный коктейль",
        "conditions": "Скидка 5%; Беларусь / Узбекистан / Россия",
        "sheetName": "ЛетоК — Сухофрукты, замороженные продукты",
        "sheetUrl":  sheet_url("ЛетоК — Сухофрукты, замороженные продукты"),
        "section": "current", "hasContract": False,
    },
    "Метро": {
        "assortment": "Fine Life варенья (вишня/клубника/черника 300г); METRO Chef; 27 категорий бакалеи",
        "conditions": "Закупочный канал (не дистрибьютор)",
        "sheetName": "Метро — Бакалея, напитки, FMCG",
        "sheetUrl":  sheet_url("Метро — Бакалея, напитки, FMCG"),
        "section": "current", "hasContract": False,
    },
    "ApexFood": {
        "assortment": "Rich сок 1л; БАД пиво 0,5л; Бон-аква 1л; молочные продукты",
        "conditions": "Розница от 2 462 руб./уп.",
        "sheetName": "ApexFood — Бакалея, кондитерские изделия",
        "sheetUrl":  sheet_url("ApexFood — Бакалея, кондитерские изделия"),
        "section": "current", "hasContract": False,
    },
    "Ашкуди Энерджи": {
        "assortment": "Ашкуди 0,45л: Belarusian Apples, White Cherry, Dynamo Power, Golden Bears — 11 вкусов",
        "conditions": "Беларусь; упаковка 12 шт./кор.",
        "email": "info@hqdpods.ru",
        "phone": "+7 (499) 110-70-44",
        "contact": "АО Меридиан-Трейд (Ивашкевич С.А.)",
        "paymentTerms": "Предоплата",
        "sheetName": "Ашкуди Энерджи — Энергетические напитки",
        "sheetUrl":  sheet_url("Ашкуди Энерджи — Энергетические напитки"),
        "section": "current", "hasContract": False,
    },
    "Мурат / Ярмарка": {
        "assortment": "Алое Вера 0,5л (12 шт/уп), Алое Вера 1,5л (6 шт/уп) — 34–86 руб./шт.",
        "conditions": "Тверь-Ярмарка; штрихкоды есть; МО",
        "sheetName": "консервы рыба-мясо",
        "section": "current", "hasContract": False,
    },
    "OKF Korea": {
        "assortment": "Корейские газированные и негазированные напитки (PDF-каталог)",
        "conditions": "Импорт из Кореи; есть договоры",
        "email": "sales10@okf.kr",
        "phone": "+7 (495) 205-35-00",
        "section": "current", "hasContract": True,
    },
    "ZSM RICHI": {
        "assortment": "Уточнить (папка с договорами есть)",
        "section": "current", "hasContract": True,
    },
    "АРТ-ГРУПП ТР": {
        "assortment": "Уточнить (договор купли-продажи от 19.01.2026)",
        "section": "current", "hasContract": True,
    },
    "Торговый Дом Восток": {
        "assortment": "Уточнить (договор №ТДВ-7980 от 18.08.2026)",
        "section": "current", "hasContract": True,
    },
    "Чупа Лэнд": {
        "assortment": "Леденцы, жевательная резинка — счёт №Ч0004062 от 14.08.2026",
        "conditions": "Договор поставки подписан",
        "section": "current", "hasContract": True,
    },
    "Eurotrade24": {
        "assortment": "Импортные снеки, печенье — 04.09.2026 прайс",
        "email": "a.majorov@eurotrade24.ru",
        "phone": "+7 (495) 646-88-xx / +7 (926) 755-58-xx",
        "contact": "Майоров А.",
        "sheetName": "Eurotrade24 — Импортные снеки, печенье",
        "sheetUrl":  sheet_url("Eurotrade24 — Импортные снеки, печенье"),
        "section": "current", "hasContract": False,
    },
    "Great Green": {
        "assortment": "Кокосовое молоко (ж/б 250мл), соус чили сладкий, шрирача, паста том-ям 400г, рисовая лапша",
        "email": "info@greatgreen.ru",
        "phone": "+7 916 171 1000",
        "sheetName": "Метро — Бакалея, напитки, FMCG",
        "section": "current", "hasContract": False,
    },
    "Аксиома": {
        "assortment": "Бакалея, специи — прайс сентябрь 2026",
        "sheetName": "Аксиома — Бакалея, специи",
        "sheetUrl":  sheet_url("Аксиома — Бакалея, специи"),
        "section": "current", "hasContract": False,
    },
    "ИнтерФуд Групп": {
        "assortment": "Белорусские традиции (302 поз.); масло оливковое; сыры; морепродукты",
        "conditions": "Условия и отсрочка запрошены",
        "sheetName": "ИнтерФуд Групп — Сыры, морепродукты",
        "sheetUrl":  sheet_url("ИнтерФуд Групп — Сыры, морепродукты"),
        "section": "current", "hasContract": False,
    },
    "Курский МЗ": {
        "assortment": "Сыры (5+ лет), сырные продукты, сливочное масло, спреды; ГОСТ; НИИ Питания",
        "conditions": "Условия и отсрочка запрошены",
        "email": "sales1@kmz.ru.com",
        "phone": "+7-4712-51-24-4 / +8-920-727-88-4",
        "sheetName": "Курский МЗ — Масло, молочная продукция",
        "sheetUrl":  sheet_url("Курский МЗ — Масло, молочная продукция"),
        "section": "current", "hasContract": True,
    },
    "Молтрейд": {
        "assortment": "Молоко у/п 1л 270 суток с ЧЗ; МЕТРО, Глобус Б2Б, Х5, Азбука",
        "conditions": "Свои фуры; договор подписан; ЭДО",
        "email": "opt.milk@bk.ru",
        "phone": "+7 (968) 946-39-xx",
        "sheetName": "Молтрейд — Молочная продукция",
        "sheetUrl":  sheet_url("Молтрейд — Молочная продукция"),
        "section": "current", "hasContract": True,
    },
    "Кэнди Фрут": {
        "assortment": "Сахарная вата капибара; Вата тату классика; попкорн; сладости (Омск)",
        "conditions": "Образцы бесплатно; доставка в МСК запрошена",
        "email": "region@prodmaster.pro",
        "sheetName": "Кэнди Фрут — Сахарная вата, сладости",
        "sheetUrl":  sheet_url("Кэнди Фрут — Сахарная вата, сладости"),
        "section": "current", "hasContract": False,
    },
    "ТД Орион": {
        "assortment": "Азиатские соусы и лапша — с картинками, каталог",
        "email": "9102501300z@gmail.com",
        "phone": "+7 910 250 1300 / +7 980 352 2222",
        "sheetName": "ТД Орион — Азиатские соусы и лапша",
        "sheetUrl":  sheet_url("ТД Орион — Азиатские соусы и лапша"),
        "section": "current", "hasContract": False,
    },
    "ТД ЕврАзия": {
        "assortment": "Заморозка: ягоды, фрукты, овощи — прямой импорт (Чили/Китай/Египет/Узбекистан/Беларусь)",
        "conditions": "ЭДО Контур Диадок; склады МСК, Екатеринбург, Тюмень, Сургут",
        "contact": "Фаткуллина Оксана",
        "email": "ro_man13@tdeur.ru",
        "phone": "8-965-506-98-39 / (343) 310-15-51 доб. 5550",
        "sheetName": "ЛетоК — Сухофрукты, замороженные продукты",
        "section": "current", "hasContract": True,
    },
    "Бочкарев / UniteBrewery": {
        "assortment": "Пиво Бочкарев; прайс сентябрь 2026",
        "conditions": "Предоплата, самовывоз",
        "email": "servicedesk@unitedbrew.com",
        "sheetName": "Бочкарев — Пиво",
        "sheetUrl":  sheet_url("Бочкарев — Пиво"),
        "section": "current", "hasContract": False,
    },
    "Мултон": {
        "assortment": "Соки Добрый, воды, напитки — прайс сентябрь 2026",
        "sheetName": "Мултон — Соки, воды, напитки",
        "sheetUrl":  sheet_url("Мултон — Соки, воды, напитки"),
        "section": "current", "hasContract": False,
    },
    "Сенежская": {
        "assortment": "Минеральная вода Сенежская; прайс + промо-лист",
        "sheetName": "Байкал — Минеральная вода",
        "section": "current", "hasContract": False,
    },
    "Черноголовка": {
        "assortment": "Газированные напитки Черноголовка; АКВА; промо-прайс",
        "sheetName": "Черноголовка — Газированные напитки",
        "sheetUrl":  sheet_url("Черноголовка — Газированные напитки"),
        "section": "current", "hasContract": False,
    },
    "Дикси": {
        "assortment": "Мультикатегорийный прайс (уточнить)",
        "section": "current", "hasContract": False,
    },
    "Скатерть-Самобранка": {
        "assortment": "Кондитерские изделия — каталог 2026",
        "section": "current", "hasContract": False,
    },
    "ТД Продвей": {
        "assortment": "Доширак, Акульчев и др.",
        "sheetName": "ТД Продвей — Доширак, Акульчев и др.",
        "sheetUrl":  sheet_url("ТД Продвей — Доширак, Акульчев и др."),
        "section": "current", "hasContract": False,
    },
}


def slugify(name: str) -> str:
    import re
    s = name.lower()
    s = re.sub(r'[^a-zа-яё0-9]', '_', s, flags=re.IGNORECASE)
    return s[:30]


def main():
    cred = credentials.Certificate(SA_KEY)
    firebase_admin.initialize_app(cred)
    db = firestore.client()

    col = db.collection(f"tenants/{BUSINESS}/suppliers")
    updated = 0

    # Обновляем напрямую по doc ID (без чтения коллекции — экономим квоту)
    for name, patch in UPDATES.items():
        doc_id = slugify(name)
        # merge=True — не перезаписывает поля которых нет в patch
        col.document(doc_id).set({"name": name, **patch}, merge=True)
        print(f"  ✅ {name} ({doc_id})")
        updated += 1

    print(f"\nОбновлено: {updated} карточек")


if __name__ == "__main__":
    main()
