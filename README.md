# Gosuslugi Portal API

REST API для реестра сотрудников. Деплой на **Fly.io** из GitHub.

## Репозиторий

`koba307/gosuslugi-portal-api` (private)

## Fly.io — деплой из GitHub

1. Откройте https://fly.io/dashboard
2. **Create app** → **Deploy from GitHub** (или Launch → подключите GitHub)
3. Выберите репозиторий **gosuslugi-portal-api**
4. В настройках приложения выполните в терминале:

```bash
fly volumes create portal_data --size 1 --region ams
fly secrets set PORTAL_ADMIN_PASSWORD=work9999
fly deploy
```

5. URL API: `https://ИМЯ-ПРИЛОЖЕНИЯ.fly.dev`
6. Проверка: `/api/health`

## Фото сотрудников

Если фото не отображаются после деплоя, установите Git и выполните в папке portal:

```powershell
.\install-git-and-push-photos.ps1
```

## После деплоя API

```powershell
.\set-api-url.ps1 -ApiUrl https://ИМЯ-ПРИЛОЖЕНИЯ.fly.dev
.\deploy-all.bat
```

## Эндпоинты

- `GET /api/health`
- `GET /api/employees`
- `POST /api/admin/login`
