# Gosuslugi Portal API

REST API для реестра сотрудников. Деплой на **Fly.io** из GitHub.

## Репозиторий (публичный)

https://github.com/koba307/gosuslugi-portal-api

Аккаунт GitHub: **koba307**

## Fly.io — деплой из GitHub

1. https://fly.io/dashboard → **Create app** → **Deploy from GitHub**
2. Подключите GitHub-аккаунт **koba307**
3. Выберите репозиторий **gosuslugi-portal-api**
4. В терминале:

```bash
fly volumes create portal_data --size 1 --region ams
fly secrets set PORTAL_ADMIN_PASSWORD=work9999
fly deploy
```

5. URL API: `https://ИМЯ-ПРИЛОЖЕНИЯ.fly.dev`
6. Проверка: `/api/health`

## После деплоя API

```powershell
.\set-api-url.ps1 -ApiUrl https://ИМЯ-ПРИЛОЖЕНИЯ.fly.dev
.\deploy-all.bat
```
