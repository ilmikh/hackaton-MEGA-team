# Работающий API и фронт

Рабочая точка входа — FastAPI /, npm start на 8010. Node только запускает Uvicorn.
npm run preview на 3000 оставлен для автономного исходного макета; там нет реальной авторизации и хранения.
В рабочем HTML демо-скрипты исключены, загружается live.js.

Сессия — HttpOnly cookie velo_session. CSRF приходит в JSON /api/me и передаётся в X-CSRFToken при записи.
Роль и владелец всегда из сессии. Логин не изменяется, саморегистрация не даёт admin.

## Endpoints
- POST /api/auth/register — username, password, name.
- POST /api/auth/login — username, password.
- POST /api/auth/logout — завершить сессию.
- GET/PATCH /api/me — профиль; PATCH только name, phone.
- POST /api/me/password — current, password; отзывает все сессии.
- GET /api/bikes — свои; админу весь реестр. q: модель/цвет/номер; UI ищет также место/владельца.
- POST /api/bikes — multipart photo, model, color, marks, spot_id.
- GET/PATCH /api/bikes/{id} — карточка/описание.
- GET /api/bikes/{id}/photo — фото с проверкой прав.
- GET /api/parkings — схема и счётчики.
- GET /api/parkings/{id}/spots — жильцу свободные; админу полные строки.
- POST /api/admin/parkings — name, description, x, y, capacity.
- POST /api/admin/bikes/{id}/placement — spot_id либо null.
- PATCH /api/admin/bikes/{id}/status — registered/donated/withdrawn/scrapped.
- PATCH /api/admin/bikes/{id}/owner — username получателя.
- GET/POST /api/requests — список/создание.
- POST /api/requests/{id}/cancel — своя ожидающая заявка.
- POST /api/admin/requests/{id}/decision — state approved/rejected и comment.
- GET /api/admin/events — журнал.
- Жильцы/даты/напоминания/документы — BACKEND_EXTRAS.md.
- QR — QR_BACKEND.md.

Заявка kind: register/place/move/release/donate/withdraw/transfer.
Для place/move нужен spot_id, для transfer — recipient (логин).
Велосипед имеет review отдельно от учётного status. Неактивному велосипеду нельзя назначить место через старую заявку.
Переходы и макет не являются проверкой прав. Все значения SQL параметризованы; HTML из пользовательских полей экранируется.

ЛКП-интеграция и внешние рассылки не входят в согласованный объём. Напоминание показывается в личном кабинете.
