/**
 * RU strings — leaving an account (ADR-257).
 *
 * Split from `ru-core` because the deletion screen is one reason to change, and the core
 * table is at its file-size budget (ADR-093).
 */
export const ruAccount = {
  "account.delete": "Удалить аккаунт",
  "account.deleteTitle": "Удалить аккаунт",
  "account.deleteBody": "Аккаунт сразу перестанет работать: сессии завершатся, войти будет нельзя. Через 14 дней личные данные будут уничтожены. Комнаты и комментарии в общих организациях останутся у организации.",
  "account.deletePassword": "Текущий пароль",
  "account.deletePhrase": "Подтверждение",
  "account.deletePhraseHint": "Введите «удалить», чтобы подтвердить.",
  "account.deleteConfirm": "Удалить аккаунт",
  "account.deleteWrongPassword": "Пароль неверный.",
  "account.deleteBadPhrase": "Введите слово «удалить».",
  "account.deleteBlocked": "Сначала назначьте другого администратора в организациях: {orgs}.",
  "account.deleteBlockedUnknown": "Сначала назначьте другого администратора в общей организации.",
  "account.deleteFailed": "Не удалось удалить аккаунт. Попробуйте ещё раз.",
  "account.deleteScheduled": "Аккаунт будет удалён {date}.",
  "account.deleteCancel": "Отменить удаление",
  "account.deleteCancelHint": "Отменить удаление можно по ссылке из письма — она действует 14 дней.",
  "account.deleteCancelled": "Удаление отменено. Войдите снова.",
  "account.deleteCancelTooLate": "14 дней прошли: удаление уже нельзя отменить.",
  "account.deleteCancelFailed": "Не удалось отменить удаление. Попробуйте ссылку из письма.",
  "account.deleteClose": "Закрыть",
  "account.deleteBanner": "Аккаунт будет удалён {date}",
  "user.deleted": "Удалённый участник",
};
