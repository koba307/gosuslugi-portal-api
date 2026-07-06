#!/usr/bin/env python3
"""Статический сервер портала + REST API для справочника сотрудников."""

from __future__ import annotations

import base64
import json
import os
import re
import secrets
import shutil
import sys
import time
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse

PORTAL_DIR = Path(__file__).resolve().parent
BUNDLED_DATA_DIR = PORTAL_DIR / "data"
DATA_ROOT = Path(os.environ.get("PORTAL_DATA_DIR", str(BUNDLED_DATA_DIR)))
DATA_FILE = DATA_ROOT / "employees.json"
VERIFICATION_FILE = DATA_ROOT / "verification_codes.json"
PHOTOS_DIR = DATA_ROOT / "photos"
CONFIG_FILE = PORTAL_DIR / "config.json"
PHOTO_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
DEFAULT_POSITION = "Сотрудник ведомства"
SESSION_TTL_SEC = 60 * 60 * 8
MAX_PHOTO_BYTES = 5 * 1024 * 1024
ALLOWED_PHOTO_MIMES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}

SESSIONS: dict[str, float] = {}


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def load_config() -> dict[str, Any]:
    if not CONFIG_FILE.is_file():
        return {}
    with CONFIG_FILE.open(encoding="utf-8") as fh:
        data = json.load(fh)
        return data if isinstance(data, dict) else {}


def get_admin_password() -> str:
    env_password = str(os.environ.get("PORTAL_ADMIN_PASSWORD") or "").strip()
    if env_password:
        return env_password
    return str(load_config().get("admin_password") or "work9999")


def bootstrap_data_dir() -> None:
    DATA_ROOT.mkdir(parents=True, exist_ok=True)
    PHOTOS_DIR.mkdir(parents=True, exist_ok=True)

    if DATA_ROOT.resolve() == BUNDLED_DATA_DIR.resolve():
        return

    bundled_employees = BUNDLED_DATA_DIR / "employees.json"
    if not DATA_FILE.is_file() and bundled_employees.is_file():
        shutil.copy2(bundled_employees, DATA_FILE)

    bundled_verification = BUNDLED_DATA_DIR / "verification_codes.json"
    if not VERIFICATION_FILE.is_file() and bundled_verification.is_file():
        shutil.copy2(bundled_verification, VERIFICATION_FILE)

    bundled_photos = BUNDLED_DATA_DIR / "photos"
    if bundled_photos.is_dir():
        for src in bundled_photos.iterdir():
            if not src.is_file():
                continue
            dst = PHOTOS_DIR / src.name
            if not dst.exists():
                shutil.copy2(src, dst)


def load_store() -> dict[str, Any]:
    if not DATA_FILE.is_file():
        return {"updated_at": utc_now(), "employees": []}
    with DATA_FILE.open(encoding="utf-8") as fh:
        data = json.load(fh)
        if not isinstance(data, dict):
            return {"updated_at": utc_now(), "employees": []}
        employees = data.get("employees")
        if not isinstance(employees, list):
            data["employees"] = []
        return data


def save_store(store: dict[str, Any]) -> None:
    store["updated_at"] = utc_now()
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    DATA_FILE.write_text(
        json.dumps(store, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def normalize_employee(raw: dict[str, Any]) -> dict[str, Any]:
    rating = raw.get("rating", 0)
    try:
        rating = float(rating)
    except (TypeError, ValueError):
        rating = 0.0
    rating = max(0.0, min(5.0, rating))

    employee_id = str(raw.get("id") or "").strip()
    name = str(raw.get("name") or "").strip()
    position = str(raw.get("position") or "").strip()

    if not employee_id:
        raise ValueError("Табельный номер обязателен")
    if not name:
        raise ValueError("ФИО обязательно")
    if not position:
        raise ValueError("Должность обязательна")

    photo = str(raw.get("photo") or "").strip()
    personal_code = normalize_personal_code(raw.get("personal_code"))

    return {
        "id": employee_id,
        "name": name,
        "position": position,
        "department": str(raw.get("department") or "").strip(),
        "hired": str(raw.get("hired") or "").strip(),
        "rating": round(rating, 1),
        "notes": str(raw.get("notes") or "").strip(),
        "photo": photo,
        "photo_focus": normalize_photo_focus(raw.get("photo_focus")),
        "personal_code": personal_code,
    }


def normalize_photo_focus(raw: Any) -> dict[str, float]:
    default = {"x": 50.0, "y": 50.0, "scale": 1.0}
    if not isinstance(raw, dict):
        return default
    try:
        x = float(raw.get("x", 50))
        y = float(raw.get("y", 50))
        scale = float(raw.get("scale", 1))
    except (TypeError, ValueError):
        return default
    return {
        "x": round(max(0.0, min(100.0, x)), 1),
        "y": round(max(0.0, min(100.0, y)), 1),
        "scale": round(max(1.0, min(3.0, scale)), 2),
    }


def normalize_personal_code(value: Any) -> str:
    code = str(value or "").strip()
    if not code:
        return ""
    if not re.fullmatch(r"\d{6}", code):
        raise ValueError("Персональный код должен содержать ровно 6 цифр")
    return code


def ensure_unique_personal_code(store: dict[str, Any], code: str, employee_id: str) -> None:
    if not code:
        return
    for employee in store.get("employees", []):
        if str(employee.get("id")) == employee_id:
            continue
        if str(employee.get("personal_code") or "") == code:
            raise ValueError("Этот персональный код уже назначен другому сотруднику")


def collect_used_personal_codes(store: dict[str, Any], exclude_id: str = "") -> set[str]:
    used: set[str] = set()
    for employee in store.get("employees", []):
        if exclude_id and str(employee.get("id")) == exclude_id:
            continue
        code = str(employee.get("personal_code") or "").strip()
        if re.fullmatch(r"\d{6}", code):
            used.add(code)
    return used


def generate_personal_code(used_codes: set[str]) -> str:
    for _ in range(10000):
        code = f"{secrets.randbelow(1_000_000):06d}"
        if code not in used_codes:
            return code
    raise ValueError("Не удалось сгенерировать уникальный персональный код")


def ensure_employee_personal_codes(store: dict[str, Any]) -> int:
    used = collect_used_personal_codes(store)
    generated = 0

    for employee in store.get("employees", []):
        code = str(employee.get("personal_code") or "").strip()
        if re.fullmatch(r"\d{6}", code):
            employee["personal_code"] = code
            continue

        new_code = generate_personal_code(used)
        employee["personal_code"] = new_code
        used.add(new_code)
        generated += 1

    return generated


def assign_personal_code_if_missing(store: dict[str, Any], employee: dict[str, Any]) -> None:
    code = str(employee.get("personal_code") or "").strip()
    if re.fullmatch(r"\d{6}", code):
        employee["personal_code"] = code
        return

    used = collect_used_personal_codes(store, exclude_id=str(employee.get("id") or ""))
    employee["personal_code"] = generate_personal_code(used)


def photo_slug(employee_id: str) -> str:
    safe = re.sub(r"[^\w\-]+", "-", employee_id.strip().replace("/", "-"))
    return safe.strip("-") or "employee"


def resolve_portal_asset(relative_path: str) -> Path | None:
    if not relative_path or relative_path.startswith("data:"):
        return None
    full = (PORTAL_DIR / relative_path).resolve()
    portal_root = PORTAL_DIR.resolve()
    if not str(full).startswith(str(portal_root)):
        return None
    return full if full.is_file() else None


def resolve_upload_photo_file(photo_path: str) -> Path | None:
    if not photo_path or not photo_path.startswith("data/photos/"):
        return None
    full = resolve_portal_asset(photo_path)
    if not full:
        return None
    photos_root = PHOTOS_DIR.resolve()
    if not str(full).startswith(str(photos_root)):
        return None
    return full


def delete_photo_file(photo_path: str) -> None:
    full = resolve_upload_photo_file(photo_path)
    if full:
        full.unlink()


def normalize_person_name(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "").lower().strip())


def names_match(left: str, right: str) -> bool:
    a = normalize_person_name(left)
    b = normalize_person_name(right)
    if not a or not b:
        return False
    if a == b:
        return True
    parts_a = a.split()
    parts_b = b.split()
    if len(parts_a) >= 2 and len(parts_b) >= 2 and parts_a[0] == parts_b[0] and parts_a[1] == parts_b[1]:
        return True
    return False


def photo_file_exists(photo_path: str) -> bool:
    return resolve_portal_asset(photo_path) is not None


def next_employee_id(store: dict[str, Any]) -> str:
    used = {str(employee.get("id")) for employee in store.get("employees", [])}
    counter = 1
    while True:
        candidate = f"{counter:03d}/{counter:03d}"
        if candidate not in used:
            return candidate
        counter += 1


def publish_employees_to_site(store: dict[str, Any] | None = None) -> dict[str, Any]:
    store = store if store is not None else load_store()
    employees = [dict(item) for item in store.get("employees", []) if isinstance(item, dict)]

    for employee in employees:
        if not str(employee.get("position") or "").strip():
            employee["position"] = DEFAULT_POSITION
        if not str(employee.get("id") or "").strip():
            employee["id"] = next_employee_id({**store, "employees": employees})
        if employee.get("rating") in (None, ""):
            employee["rating"] = 4.5
        if employee.get("photo_focus") is not None:
            employee["photo_focus"] = normalize_photo_focus(employee.get("photo_focus"))

    store["employees"] = employees
    codes_generated = ensure_employee_personal_codes(store)
    save_store(store)

    published = sum(
        1
        for employee in employees
        if str(employee.get("name") or "").strip() and str(employee.get("id") or "").strip()
    )

    return {
        "codes_generated": codes_generated,
        "total": len(employees),
        "published": published,
        "updated_at": store.get("updated_at"),
    }


def load_verification_store() -> dict[str, Any]:
    if not VERIFICATION_FILE.is_file():
        return {"records": []}
    with VERIFICATION_FILE.open(encoding="utf-8") as fh:
        data = json.load(fh)
        if not isinstance(data, dict):
            return {"records": []}
        records = data.get("records")
        if not isinstance(records, list):
            data["records"] = []
        return data


def save_verification_store(store: dict[str, Any]) -> None:
    VERIFICATION_FILE.parent.mkdir(parents=True, exist_ok=True)
    VERIFICATION_FILE.write_text(
        json.dumps(store, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def client_ip(headers, client_address: tuple[str, int] | None) -> str:
    forwarded = headers.get("X-Forwarded-For", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    real_ip = headers.get("X-Real-IP", "")
    if real_ip:
        return real_ip.strip()
    if client_address:
        return str(client_address[0])
    return "unknown"


def find_verification_record(store: dict[str, Any], employee_id: str, ip: str) -> dict[str, Any] | None:
    for record in store.get("records", []):
        if not isinstance(record, dict):
            continue
        if str(record.get("employee_id")) == employee_id and str(record.get("ip")) == ip:
            return record
    return None


def parse_data_url_image(data_url: str) -> tuple[bytes, str]:
    match = re.match(r"^data:([^;]+);base64,(.+)$", data_url.strip(), re.DOTALL)
    if not match:
        raise ValueError("Некорректный формат изображения")
    mime = match.group(1).lower()
    if mime not in ALLOWED_PHOTO_MIMES:
        raise ValueError("Допустимы только JPEG, PNG, WebP и GIF")
    try:
        data = base64.b64decode(match.group(2), validate=True)
    except Exception as exc:
        raise ValueError("Некорректные данные изображения") from exc
    if len(data) > MAX_PHOTO_BYTES:
        raise ValueError("Файл слишком большой (максимум 5 МБ)")
    if len(data) == 0:
        raise ValueError("Пустой файл изображения")
    return data, mime


def save_photo_file(employee_id: str, image_data: bytes, mime: str) -> str:
    PHOTOS_DIR.mkdir(parents=True, exist_ok=True)
    ext = ALLOWED_PHOTO_MIMES[mime]
    filename = f"{photo_slug(employee_id)}{ext}"
    target = PHOTOS_DIR / filename
    target.write_bytes(image_data)
    return f"data/photos/{filename}"


def rename_photo_file(photo_path: str, employee_id: str) -> str:
    old_file = resolve_upload_photo_file(photo_path)
    if not old_file:
        return photo_path
    new_name = f"{photo_slug(employee_id)}{old_file.suffix}"
    new_file = PHOTOS_DIR / new_name
    if old_file == new_file:
        return photo_path
    new_file.write_bytes(old_file.read_bytes())
    old_file.unlink(missing_ok=True)
    return f"data/photos/{new_name}"


def find_employee(store: dict[str, Any], employee_id: str) -> tuple[int, dict[str, Any] | None]:
    for index, employee in enumerate(store.get("employees", [])):
        if str(employee.get("id")) == employee_id:
            return index, employee
    return -1, None


def cleanup_sessions() -> None:
    now = time.time()
    expired = [token for token, expiry in SESSIONS.items() if expiry <= now]
    for token in expired:
        SESSIONS.pop(token, None)


def is_authorized(headers) -> bool:
    cleanup_sessions()
    auth = headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return False
    token = auth[7:].strip()
    expiry = SESSIONS.get(token)
    return bool(expiry and expiry > time.time())


class PortalAPIHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(PORTAL_DIR), **kwargs)

    def log_message(self, format: str, *args) -> None:
        if str(args[0]).startswith("GET /api/") or str(args[0]).startswith("POST /api/"):
            sys.stderr.write("%s - - [%s] %s\n" % (self.address_string(), self.log_date_time_string(), format % args))

    def end_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
        path = urlparse(self.path).path.lower()
        if path.endswith((".js", ".css", ".html", ".json")) or path.startswith("/api/"):
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
            self.send_header("Pragma", "no-cache")
        super().end_headers()

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self.handle_api_get(parsed)
            return
        super().do_GET()

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self.handle_api_post(parsed)
            return
        self.send_error(HTTPStatus.METHOD_NOT_ALLOWED)

    def do_PUT(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/employees/"):
            self.handle_api_put(parsed)
            return
        self.send_error(HTTPStatus.METHOD_NOT_ALLOWED)

    def do_PATCH(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/employees/") and parsed.path.endswith("/photo-focus"):
            self.handle_api_save_photo_focus(parsed)
            return
        self.send_error(HTTPStatus.METHOD_NOT_ALLOWED)

    def do_DELETE(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/employees/"):
            if parsed.path.endswith("/photo"):
                self.handle_api_delete_photo(parsed)
                return
            self.handle_api_delete(parsed)
            return
        self.send_error(HTTPStatus.METHOD_NOT_ALLOWED)

    def read_json_body(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", 0))
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        try:
            data = json.loads(raw.decode("utf-8"))
            return data if isinstance(data, dict) else {}
        except json.JSONDecodeError as exc:
            raise ValueError("Некорректный JSON") from exc

    def send_json(self, status: int, payload: Any) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def handle_api_get(self, parsed) -> None:
        path = parsed.path

        if path == "/api/health":
            store = load_store()
            self.send_json(
                HTTPStatus.OK,
                {
                    "ok": True,
                    "service": "portal",
                    "updated_at": store.get("updated_at"),
                    "employees_count": len(store.get("employees", [])),
                },
            )
            return

        if path == "/api/employees":
            store = load_store()
            employees = store.get("employees", [])
            self.send_json(HTTPStatus.OK, {"updated_at": store.get("updated_at"), "employees": employees})
            return

        if path == "/api/verification/status":
            params = parse_qs(parsed.query or "")
            employee_id = str((params.get("employee_id") or [""])[0]).strip()
            if not employee_id:
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": "Укажите employee_id"})
                return

            ip = client_ip(self.headers, self.client_address)
            record = find_verification_record(load_verification_store(), employee_id, ip)
            if record and str(record.get("code") or "").strip():
                self.send_json(
                    HTTPStatus.OK,
                    {
                        "verified": True,
                        "code": str(record.get("code")),
                        "employee_id": employee_id,
                        "ip": ip,
                    },
                )
                return

            self.send_json(
                HTTPStatus.OK,
                {"verified": False, "code": None, "employee_id": employee_id, "ip": ip},
            )
            return

        if path == "/api/employees/all":
            if not is_authorized(self.headers):
                self.send_json(HTTPStatus.UNAUTHORIZED, {"error": "Требуется авторизация"})
                return
            store = load_store()
            self.send_json(HTTPStatus.OK, store)
            return

        if path.startswith("/api/employees/"):
            remainder = unquote(path.split("/api/employees/", 1)[1])
            if remainder.endswith("/photo"):
                self.send_json(HTTPStatus.METHOD_NOT_ALLOWED, {"error": "Используйте POST или DELETE"})
                return
            employee_id = remainder
            store = load_store()
            _, employee = find_employee(store, employee_id)
            if not employee:
                self.send_json(HTTPStatus.NOT_FOUND, {"error": "Сотрудник не найден"})
                return
            self.send_json(HTTPStatus.OK, employee)
            return

        self.send_json(HTTPStatus.NOT_FOUND, {"error": "Маршрут не найден"})

    def handle_api_post(self, parsed) -> None:
        path = parsed.path

        if path == "/api/admin/login":
            try:
                body = self.read_json_body()
            except ValueError as exc:
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
                return

            password = str(body.get("password") or "")
            expected = get_admin_password()
            if password != expected:
                self.send_json(HTTPStatus.UNAUTHORIZED, {"error": "Неверный пароль"})
                return

            token = secrets.token_urlsafe(32)
            SESSIONS[token] = time.time() + SESSION_TTL_SEC
            self.send_json(HTTPStatus.OK, {"token": token, "expires_in": SESSION_TTL_SEC})
            return

        if path == "/api/admin/logout":
            auth = self.headers.get("Authorization", "")
            if auth.startswith("Bearer "):
                SESSIONS.pop(auth[7:].strip(), None)
            self.send_json(HTTPStatus.OK, {"ok": True})
            return

        if path == "/api/admin/publish-site":
            if not is_authorized(self.headers):
                self.send_json(HTTPStatus.UNAUTHORIZED, {"error": "Требуется авторизация"})
                return
            result = publish_employees_to_site(load_store())
            self.send_json(HTTPStatus.OK, result)
            return

        if path == "/api/verification/generate":
            try:
                body = self.read_json_body()
            except ValueError as exc:
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
                return

            employee_id = str(body.get("employee_id") or "").strip()
            if not employee_id:
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": "Укажите employee_id"})
                return

            store = load_store()
            _, employee = find_employee(store, employee_id)
            if not employee:
                self.send_json(HTTPStatus.NOT_FOUND, {"error": "Сотрудник не найден"})
                return

            ip = client_ip(self.headers, self.client_address)
            verification_store = load_verification_store()
            existing = find_verification_record(verification_store, employee_id, ip)
            if existing and str(existing.get("code") or "").strip():
                self.send_json(
                    HTTPStatus.OK,
                    {
                        "already_verified": True,
                        "code": str(existing.get("code")),
                        "employee_id": employee_id,
                        "ip": ip,
                    },
                )
                return

            personal_code = str(employee.get("personal_code") or "").strip()
            if not re.fullmatch(r"\d{6}", personal_code):
                assign_personal_code_if_missing(store, employee)
                index, _ = find_employee(store, employee_id)
                if index >= 0:
                    store["employees"][index] = employee
                    save_store(store)
                personal_code = str(employee.get("personal_code") or "").strip()

            verification_store.setdefault("records", []).append(
                {
                    "employee_id": employee_id,
                    "ip": ip,
                    "code": personal_code,
                    "created_at": utc_now(),
                }
            )
            save_verification_store(verification_store)
            self.send_json(
                HTTPStatus.OK,
                {
                    "already_verified": False,
                    "code": personal_code,
                    "employee_id": employee_id,
                    "ip": ip,
                },
            )
            return

        if path == "/api/employees":
            if not is_authorized(self.headers):
                self.send_json(HTTPStatus.UNAUTHORIZED, {"error": "Требуется авторизация"})
                return
            try:
                body = self.read_json_body()
                employee = normalize_employee(body)
            except ValueError as exc:
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
                return

            store = load_store()
            _, existing = find_employee(store, employee["id"])
            if existing:
                self.send_json(HTTPStatus.CONFLICT, {"error": "Сотрудник с таким табельным номером уже существует"})
                return

            assign_personal_code_if_missing(store, employee)

            try:
                ensure_unique_personal_code(store, employee["personal_code"], employee["id"])
            except ValueError as exc:
                self.send_json(HTTPStatus.CONFLICT, {"error": str(exc)})
                return

            store.setdefault("employees", []).append(employee)
            save_store(store)
            self.send_json(HTTPStatus.CREATED, employee)
            return

        if path.startswith("/api/employees/") and path.endswith("/photo"):
            if not is_authorized(self.headers):
                self.send_json(HTTPStatus.UNAUTHORIZED, {"error": "Требуется авторизация"})
                return
            employee_id = unquote(path[len("/api/employees/") : -len("/photo")])
            try:
                body = self.read_json_body()
                image_data, mime = parse_data_url_image(str(body.get("image") or ""))
            except ValueError as exc:
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
                return

            store = load_store()
            index, existing = find_employee(store, employee_id)
            if not existing:
                self.send_json(HTTPStatus.NOT_FOUND, {"error": "Сотрудник не найден"})
                return

            old_photo = str(existing.get("photo") or "")
            if old_photo:
                delete_photo_file(old_photo)

            photo_path = save_photo_file(employee_id, image_data, mime)
            employee = dict(existing)
            employee["photo"] = photo_path
            if "photo_focus" in body:
                employee["photo_focus"] = normalize_photo_focus(body.get("photo_focus"))
            store["employees"][index] = employee
            save_store(store)
            self.send_json(
                HTTPStatus.OK,
                {
                    "photo": photo_path,
                    "employee": employee,
                    "updated_at": store.get("updated_at"),
                },
            )
            return

        if path.startswith("/api/employees/") and path.endswith("/photo-focus"):
            self.handle_api_save_photo_focus(parsed)
            return

        self.send_json(HTTPStatus.NOT_FOUND, {"error": "Маршрут не найден"})

    def handle_api_save_photo_focus(self, parsed) -> None:
        if not is_authorized(self.headers):
            self.send_json(HTTPStatus.UNAUTHORIZED, {"error": "Требуется авторизация"})
            return

        employee_id = unquote(parsed.path[len("/api/employees/") : -len("/photo-focus")])
        try:
            body = self.read_json_body()
        except ValueError as exc:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
            return

        store = load_store()
        index, existing = find_employee(store, employee_id)
        if not existing:
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "Сотрудник не найден"})
            return

        employee = dict(existing)
        employee["photo_focus"] = normalize_photo_focus(body.get("photo_focus"))
        store["employees"][index] = employee
        save_store(store)
        self.send_json(
            HTTPStatus.OK,
            {
                "ok": True,
                "employee": employee,
                "updated_at": store.get("updated_at"),
            },
        )

    def handle_api_put(self, parsed) -> None:
        if not is_authorized(self.headers):
            self.send_json(HTTPStatus.UNAUTHORIZED, {"error": "Требуется авторизация"})
            return

        employee_id = unquote(parsed.path.split("/api/employees/", 1)[1])
        try:
            body = self.read_json_body()
            employee = normalize_employee({**body, "id": body.get("id") or employee_id})
        except ValueError as exc:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
            return

        store = load_store()
        index, existing = find_employee(store, employee_id)
        if not existing:
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "Сотрудник не найден"})
            return

        if employee["id"] != employee_id:
            _, conflict = find_employee(store, employee["id"])
            if conflict:
                self.send_json(HTTPStatus.CONFLICT, {"error": "Табельный номер уже занят"})
                return
            if employee.get("photo"):
                employee["photo"] = rename_photo_file(str(employee["photo"]), employee["id"])

        if not employee["personal_code"]:
            existing_code = str(existing.get("personal_code") or "").strip()
            if re.fullmatch(r"\d{6}", existing_code):
                employee["personal_code"] = existing_code
            else:
                assign_personal_code_if_missing(store, employee)

        try:
            ensure_unique_personal_code(store, employee["personal_code"], employee["id"])
        except ValueError as exc:
            self.send_json(HTTPStatus.CONFLICT, {"error": str(exc)})
            return

        old_photo = str(existing.get("photo") or "")
        new_photo = str(employee.get("photo") or "").strip()
        if not new_photo and old_photo:
            employee["photo"] = old_photo
        elif new_photo:
            employee["photo"] = new_photo

        if not isinstance(body.get("photo_focus"), dict):
            employee["photo_focus"] = normalize_photo_focus(existing.get("photo_focus"))

        store["employees"][index] = employee
        save_store(store)
        self.send_json(HTTPStatus.OK, employee)

    def handle_api_delete(self, parsed) -> None:
        if not is_authorized(self.headers):
            self.send_json(HTTPStatus.UNAUTHORIZED, {"error": "Требуется авторизация"})
            return

        employee_id = unquote(parsed.path.split("/api/employees/", 1)[1])
        store = load_store()
        index, existing = find_employee(store, employee_id)
        if not existing:
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "Сотрудник не найден"})
            return

        old_photo = str(existing.get("photo") or "")
        if old_photo:
            delete_photo_file(old_photo)

        store["employees"].pop(index)
        save_store(store)
        self.send_json(HTTPStatus.OK, {"ok": True, "id": employee_id})

    def handle_api_delete_photo(self, parsed) -> None:
        if not is_authorized(self.headers):
            self.send_json(HTTPStatus.UNAUTHORIZED, {"error": "Требуется авторизация"})
            return

        employee_id = unquote(parsed.path[len("/api/employees/") : -len("/photo")])
        store = load_store()
        index, existing = find_employee(store, employee_id)
        if not existing:
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "Сотрудник не найден"})
            return

        old_photo = str(existing.get("photo") or "")
        if old_photo:
            delete_photo_file(old_photo)

        employee = dict(existing)
        employee["photo"] = ""
        employee["photo_focus"] = normalize_photo_focus(None)
        store["employees"][index] = employee
        save_store(store)
        self.send_json(HTTPStatus.OK, {"ok": True, "employee": employee})


def main() -> None:
    bootstrap_data_dir()

    port = int(os.environ.get("PORT", "8780"))
    if len(sys.argv) > 1:
        port = int(sys.argv[1])

    try:
        sync_result = publish_employees_to_site(load_store())
        codes_msg = ""
        if sync_result.get("codes_generated"):
            codes_msg = f", кодов сгенерировано: {sync_result['codes_generated']}"
        print(
            "✓ Справочник сотрудников подготовлен: "
            f"{sync_result['published']} записей{codes_msg}"
        )
    except Exception as exc:
        print(f"! Не удалось подготовить справочник сотрудников: {exc}")

    server = ThreadingHTTPServer(("0.0.0.0", port), PortalAPIHandler)
    print(f"✓ Портал: http://localhost:{port}/index.html")
    print(f"  Ведомства: http://localhost:{port}/verification.html")
    #print(f"  Админка: http://localhost:{port}/admin.html (синхронизация с сайтом автоматически)")
    print(f"  API: http://localhost:{port}/api/employees")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nОстановлено")
        server.server_close()


if __name__ == "__main__":
    main()
