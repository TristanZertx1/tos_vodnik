<?php
// One-time installer: creates database tables, the administrator account and the initial public materials.
// After a successful installation, DELETE this file from the server.
declare(strict_types=1);

require __DIR__ . '/lib/bootstrap.php';
require __DIR__ . '/lib/validate.php';

header('X-Robots-Tag: noindex, nofollow');
header('Content-Type: text/html; charset=utf-8');

function page(string $body): never
{
    echo '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        . '<meta name="robots" content="noindex"><title>Установка сайта «Водники»</title>'
        . '<style>body{font-family:Arial,sans-serif;max-width:560px;margin:40px auto;padding:0 16px;line-height:1.5}label{display:block;margin:14px 0 4px}input{width:100%;padding:8px;box-sizing:border-box}button{margin-top:18px;padding:10px 18px}.error{color:#a00}.ok{color:#060}</style>'
        . '</head><body>' . $body . '</body></html>';
    exit;
}

try {
    $setupToken = (string) (config()['setup_token'] ?? '');
    if ($setupToken === '' || str_starts_with($setupToken, 'CHANGE_ME')) {
        page('<h1>Установка</h1><p class="error">В api/config.php задайте setup_token.</p>');
    }

    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
        page('<h1>Установка сайта «Водники»</h1>'
            . '<form method="post"><label>Установочный код (setup_token из api/config.php)<input name="setup_token" type="password" required></label>'
            . '<label>Пароль администратора (не короче 10 символов)<input name="password" type="password" minlength="10" maxlength="128" required autocomplete="new-password"></label>'
            . '<button type="submit">Установить</button></form>');
    }

    $token = (string) ($_POST['setup_token'] ?? '');
    if (!hash_equals($setupToken, $token)) {
        page('<h1>Установка</h1><p class="error">Неверный установочный код.</p>');
    }
    $password = (string) ($_POST['password'] ?? '');
    if (!validPassword($password)) {
        page('<h1>Установка</h1><p class="error">Пароль администратора: от 10 до 128 символов.</p>');
    }

    installSchema();

    $admin = one("SELECT id FROM cms_users WHERE username = 'admin'");
    if ($admin !== null) {
        page('<h1>Установка</h1><p class="error">Администратор уже создан. Удалите файл api/setup.php с сервера.</p>');
    }

    transaction(function () use ($password) {
        query("INSERT INTO cms_users (id, username, password, role, enabled, created_at) VALUES ('admin', 'admin', ?, 'admin', 1, ?)",
            [password_hash($password, PASSWORD_DEFAULT), now()]);

        // Initial public materials taken from the verified public sources (one-time import).
        $seed = json_decode((string) file_get_contents(__DIR__ . '/lib/seed-data.json'), true) ?: [];
        foreach ($seed as $record) {
            if (one('SELECT id FROM cms_records WHERE id = ?', [$record['id']]) === null) {
                query('INSERT INTO cms_records (id, kind, data, published, revision, updated_at, updated_by) VALUES (?, ?, ?, 1, 1, ?, ?)',
                    [$record['id'], $record['kind'], json_encode($record['data'], JSON_UNESCAPED_UNICODE), now(), 'public-sources']);
            }
        }
    });

    page('<h1>Установка завершена</h1>'
        . '<p class="ok">Таблицы созданы, администратор добавлен, начальные материалы загружены.</p>'
        . '<p><strong>Удалите файл api/setup.php с сервера сейчас</strong>, иначе установщик останется доступен.</p>'
        . '<p>Панель редактирования: <a href="/admin/">/admin/</a>, логин: admin.</p>');
} catch (Throwable $error) {
    error_log('[setup] ' . $error->getMessage());
    page('<h1>Установка</h1><p class="error">Не удалось выполнить установку. Проверьте настройки базы данных в api/config.php.</p>');
}
