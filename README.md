# Gosuslugi Portal

Полный портал: **фронт + REST API** реестра сотрудников.  
Боевой URL: **https://gosuslugi.fly.dev**

Репозиторий: https://github.com/koba307/gosuslugi-portal-api  
Аккаунт GitHub: **koba307** · Fly app: **`gosuslugi`**

## Состав

| Путь | Назначение |
|------|------------|
| `portal_api.py` | API + статический сервер |
| `index.html` | Публичный портал |
| `admin.html` | Админ-панель |
| `verification.html` | Ведомства / проверка |
| `data/` | Стартовые данные (боевые — на Fly volume `/data`) |
| `fly.toml` | Конфиг Fly (`app = gosuslugi`) |

## Страницы

- Сайт: https://gosuslugi.fly.dev/
- Админка: https://gosuslugi.fly.dev/admin.html
- Ведомства: https://gosuslugi.fly.dev/verification.html
- Health: https://gosuslugi.fly.dev/api/health
- API: https://gosuslugi.fly.dev/api/employees

## Локальный запуск

```bash
python portal_api.py
# http://localhost:8780/
```

## Деплой на Fly.io

App: **gosuslugi** · регион volume: **ams** · машина **всегда online** (`min_machines_running = 1`, `auto_stop_machines = off`).

```bash
# один раз (если volume ещё нет)
fly volumes create portal_data --size 1 --region ams -a gosuslugi

fly secrets set PORTAL_ADMIN_PASSWORD='***' -a gosuslugi
fly deploy -a gosuslugi
```

Проверка:

```bash
curl https://gosuslugi.fly.dev/api/health
```

## Конфиг

`config.json`:

- `api_base_url` / `site_url` → `https://gosuslugi.fly.dev`
- `admin_url` → `https://gosuslugi.fly.dev/admin.html`
- пароль админа лучше через secret `PORTAL_ADMIN_PASSWORD`

## Важно

- Volume `portal_data` хранит `employees.json`, фото, verification — **не удалять** при деплое.
- Фото в git могут отсутствовать; на проде они в volume.
