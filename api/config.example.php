<?php
// Скопируйте этот файл в api/config.php и заполните значения.
// api/config.php не загружается в репозиторий: в нём пароли от базы данных.
return [
    'db' => [
        'driver' => 'mysql',
        'host' => 'localhost',          // адрес MySQL из панели хостинга (обычно localhost)
        'name' => 'CHANGE_ME',          // имя базы данных
        'user' => 'CHANGE_ME',          // пользователь базы данных
        'pass' => 'CHANGE_ME',          // пароль пользователя базы данных
    ],
    // Адрес сайта. Запросы на изменение данных принимаются только с этого адреса.
    'site_origin' => 'https://tos-vodniki.ru',
    // Куки панели администратора передаются только по HTTPS.
    'cookie_secure' => true,
    // Одноразовый секрет для установки (api/setup.php). Удалите установщик после настройки.
    'setup_token' => 'CHANGE_ME_LONG_RANDOM_STRING',
    // Почта для уведомлений о новых записях на мероприятия. Пустая строка — не отправлять.
    'notify_email' => 'info@tos-vodniki.ru',
    // Адрес отправителя уведомлений (должен принадлежать домену сайта).
    'mail_from' => 'info@tos-vodniki.ru',
    // SMTP credentials are stored only in api/config.php on the hosting server.
    'smtp' => [
        'host' => 'mail.hosting.reg.ru',
        'port' => 465,
        'encryption' => 'ssl',
        'username' => 'info@tos-vodniki.ru',
        'password' => '',
    ],
];
