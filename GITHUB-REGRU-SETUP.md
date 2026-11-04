# GitHub → REG.ru

Добавьте в GitHub Settings → Secrets and variables → Actions:

- REGRU_FTP_HOST — FTP-сервер REG.ru
- REGRU_FTP_USER — FTP-пользователь
- REGRU_FTP_PASSWORD — пароль FTP

После push в main workflow загрузит site-source в /www/tos-vodniki.ru/.
Пароли не храните в репозитории.
