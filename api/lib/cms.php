<?php
// Public content, analytics, event registration and the admin panel API. Ported from lib/cms.ts and lib/event-registration.ts.
declare(strict_types=1);

const SESSION_COOKIE = 'vodniki_cms';
const SESSION_SECONDS = 28800;

// ---------- public content ----------

function readPublic(): array
{
    $content = ['news' => [], 'events' => [], 'projects' => [], 'documents' => [], 'contacts' => [], 'layout' => []];
    $rows = all('SELECT id, kind, data FROM cms_records WHERE published = 1 ORDER BY updated_at DESC');
    foreach ($rows as $row) {
        $data = json_decode($row['data'], true) ?: [];
        if ($row['kind'] === 'contacts') {
            $content['contacts'] = $data;
        } elseif ($row['kind'] === 'layout') {
            $content['layout'] = $data['settings'] ?? [];
        } elseif (array_key_exists($row['kind'], $content) && is_array($content[$row['kind']])) {
            $content[$row['kind']][] = $row['kind'] === 'events' ? $data + ['id' => $row['id']] : $data;
        }
    }
    if ($content['events']) {
        $counts = [];
        foreach (all("SELECT event_id, SUM(seats) AS registered FROM cms_event_registrations WHERE status = 'confirmed' GROUP BY event_id") as $row) {
            $counts[$row['event_id']] = (int) $row['registered'];
        }
        $content['events'] = array_map(function (array $event) use ($counts) {
            $registered = $counts[$event['id']] ?? 0;
            $event['registeredCount'] = $registered;
            $event['availableSeats'] = max(0, (int) ($event['capacity'] ?? 0) - $registered);
            return $event;
        }, $content['events']);
    }
    return $content;
}

function isPublishedNewsSlug(string $slug): bool
{
    foreach (all("SELECT data FROM cms_records WHERE kind = 'news' AND published = 1") as $row) {
        $data = json_decode($row['data'], true) ?: [];
        if (($data['slug'] ?? null) === $slug) {
            return true;
        }
    }
    return false;
}

// ---------- analytics (aggregated page views, no visitor identifiers) ----------

function recordPageView(mixed $input): void
{
    if (!is_array($input) || !is_string($input['path'] ?? null) || mb_strlen($input['path']) > 180) {
        fail('Неверная страница.');
    }
    $path = explode('?', $input['path'])[0];
    $path = rtrim($path, '/') ?: '/';
    $fixed = ['/', '/o-tos', '/novosti', '/meropriyatiya', '/proekty', '/dokumenty', '/kontakty', '/politika'];
    if (!in_array($path, $fixed, true)) {
        // Other pages (event cards, unknown addresses) are not counted; this is not an error for the visitor.
        if (!preg_match('/^\/novosti\/([a-z0-9]+(?:-[a-z0-9]+)*)$/', $path, $m) || !isPublishedNewsSlug($m[1])) {
            return;
        }
    }
    $day = date('Y-m-d');
    transaction(function () use ($day, $path) {
        $row = one('SELECT views FROM cms_page_views WHERE day = ? AND path = ?' . lockSuffix(), [$day, $path]);
        if ($row === null) {
            query('INSERT INTO cms_page_views (day, path, views) VALUES (?, ?, 1)', [$day, $path]);
        } else {
            query('UPDATE cms_page_views SET views = views + 1 WHERE day = ? AND path = ?', [$day, $path]);
        }
    });
}

function analytics(): array
{
    $since = date('Y-m-d', strtotime('-29 days'));
    $weekSince = date('Y-m-d', strtotime('-6 days'));
    $daily = all('SELECT day, SUM(views) AS views FROM cms_page_views WHERE day >= ? GROUP BY day ORDER BY day', [$since]);
    $pages = all('SELECT path, SUM(views) AS views FROM cms_page_views WHERE day >= ? GROUP BY path ORDER BY views DESC LIMIT 20', [$since]);
    $totals = one(
        'SELECT COALESCE(SUM(CASE WHEN day >= ? THEN views ELSE 0 END), 0) AS month_views,
                COALESCE(SUM(CASE WHEN day >= ? THEN views ELSE 0 END), 0) AS week_views
         FROM cms_page_views WHERE day >= ?',
        [$since, $weekSince, $since]
    );
    return [
        'daily' => array_map(fn($r) => ['day' => $r['day'], 'views' => (int) $r['views']], $daily),
        'pages' => array_map(fn($r) => ['path' => $r['path'], 'views' => (int) $r['views']], $pages),
        'month' => (int) ($totals['month_views'] ?? 0),
        'week' => (int) ($totals['week_views'] ?? 0),
    ];
}

// ---------- event registration ----------

function registerForEvent(string $eventId, mixed $input): array
{
    assertSameOrigin();
    if (!is_array($input)) {
        fail('Заполните форму и повторите отправку.');
    }
    $name = is_string($input['name'] ?? null) ? preg_replace('/\s+/u', ' ', trim($input['name'])) : '';
    $digits = is_string($input['phone'] ?? null) ? preg_replace('/\D/', '', $input['phone']) : '';
    if (strlen($digits) === 10) {
        $digits = '7' . $digits;
    } elseif (strlen($digits) === 11 && $digits[0] === '8') {
        $digits = '7' . substr($digits, 1);
    }
    $phone = '+' . $digits;
    $seats = $input['seats'] ?? null;
    $seats = is_numeric($seats) ? (int) $seats : 0;
    $consent = in_array($input['consent'] ?? null, ['on', 'true', '1', true, 1], true);

    if (!preg_match('/^\p{L}[\p{L} .\'-]{1,98}$/u', $name) || strlen($digits) < 10 || strlen($digits) > 15 || $seats < 1 || $seats > 5) {
        fail('Проверьте имя, телефон и количество мест.');
    }
    if (!$consent) {
        fail('Подтвердите согласие на обработку персональных данных.');
    }

    $rateKey = 'event-register:' . $eventId . ':' . hash('sha256', clientIp());
    if (attemptCount($rateKey) >= 8) {
        fail('Слишком много заявок с этого подключения. Попробуйте позже.', 429);
    }
    bumpAttempt($rateKey, 3600);

    $time = now();
    $registered = transaction(function () use ($eventId, $name, $phone, $seats, $time) {
        $event = one("SELECT id, data FROM cms_records WHERE id = ? AND kind = 'events' AND published = 1" . lockSuffix(), [$eventId]);
        if ($event === null) {
            fail('Мероприятие не найдено.', 404);
        }
        $data = json_decode($event['data'], true) ?: [];
        $today = date('Y-m-d');
        if (($data['registrationEnabled'] ?? false) !== true || ($data['date'] ?? '') < $today) {
            fail('Запись закрыта или свободных мест уже не осталось.', 409);
        }
        $capacity = (int) ($data['capacity'] ?? 0);
        $reserved = (int) (one("SELECT COALESCE(SUM(seats), 0) AS seats FROM cms_event_registrations WHERE event_id = ? AND status = 'confirmed'", [$eventId])['seats'] ?? 0);
        $existing = one('SELECT status FROM cms_event_registrations WHERE event_id = ? AND phone = ?' . lockSuffix(), [$eventId, $phone]);
        if ($existing && $existing['status'] === 'confirmed') {
            fail('На этот номер телефона уже оформлена запись.', 409);
        }
        if ($reserved + $seats > $capacity) {
            fail('Запись закрыта или свободных мест уже не осталось.', 409);
        }
        if ($existing) {
            query("UPDATE cms_event_registrations SET name = ?, seats = ?, status = 'confirmed', created_at = ?, consent_at = ? WHERE event_id = ? AND phone = ?",
                [$name, $seats, $time, $time, $eventId, $phone]);
        } else {
            query("INSERT INTO cms_event_registrations (id, event_id, name, phone, seats, status, created_at, consent_at) VALUES (?, ?, ?, ?, ?, 'confirmed', ?, ?)",
                [bin2hex(random_bytes(16)), $eventId, $name, $phone, $seats, $time, $time]);
        }
        $total = (int) (one("SELECT COALESCE(SUM(seats), 0) AS seats FROM cms_event_registrations WHERE event_id = ? AND status = 'confirmed'", [$eventId])['seats'] ?? 0);
        return ['title' => (string) ($data['title'] ?? $eventId), 'registered' => $total, 'capacity' => $capacity];
    });

    notifyAboutRegistration($registered, $name, $phone, $seats);
    return [
        'ok' => true,
        'registered' => $registered['registered'],
        'available' => max(0, $registered['capacity'] - $registered['registered']),
    ];
}

function notifyAboutRegistration(array $event, string $name, string $phone, int $seats): void
{
    $to = (string) (config()['notify_email'] ?? '');
    if ($to === '') {
        return;
    }
    $from = (string) (config()['mail_from'] ?? 'noreply@localhost');
    $subject = '=?UTF-8?B?' . base64_encode('Новая запись на мероприятие: ' . $event['title']) . '?=';
    $body = implode("\n", [
        'Новая запись на мероприятие',
        'Мероприятие: ' . $event['title'],
        'Имя: ' . $name,
        'Телефон: ' . $phone,
        'Количество мест: ' . $seats,
        'Всего занято: ' . $event['registered'] . ' из ' . $event['capacity'],
    ]);
    // Failure to send must not fail the registration, which is already saved.
    @mail($to, $subject, $body, "From: {$from}\r\nContent-Type: text/plain; charset=UTF-8");
}

// ---------- admin session ----------

function currentSession(): ?array
{
    $token = $_COOKIE[SESSION_COOKIE] ?? '';
    if (!is_string($token) || !preg_match('/^[a-f0-9]{64}$/', $token)) {
        return null;
    }
    $row = one(
        'SELECT s.token, s.csrf, u.id, u.username, u.role
         FROM cms_sessions s JOIN cms_users u ON s.user_id = u.id
         WHERE s.token = ? AND s.expires > ? AND u.enabled = 1',
        [hash('sha256', $token), now()]
    );
    return $row ?: null;
}

function setSessionCookie(string $value, int $maxAge): void
{
    setcookie(SESSION_COOKIE, $value, [
        'expires' => $maxAge > 0 ? now() + $maxAge : 1,
        'path' => '/',
        'secure' => (bool) (config()['cookie_secure'] ?? true),
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
}

function requireSession(): array
{
    $session = currentSession();
    if ($session === null) {
        fail('Войдите в панель администратора.', 401);
    }
    return $session;
}

function requireAdmin(array $session): void
{
    if ($session['role'] !== 'admin') {
        fail('Это действие доступно только администратору.', 403);
    }
}

function requireCsrf(array $session): void
{
    assertSameOrigin();
    if (($_SERVER['HTTP_X_CSRF_TOKEN'] ?? '') !== $session['csrf']) {
        fail('Обновите страницу панели и повторите действие.', 403);
    }
}

function login(array $input): array
{
    assertSameOrigin();
    $key = ipKey('login');
    if (attemptCount($key) >= 10) {
        fail('Слишком много попыток входа. Повторите через 15 минут.', 429);
    }
    bumpAttempt($key, 900);
    $username = $input['username'] ?? null;
    $user = validUsername($username) ? one('SELECT * FROM cms_users WHERE username = ?', [$username]) : null;
    $password = is_string($input['password'] ?? null) && mb_strlen($input['password']) <= 128 ? $input['password'] : '';
    // Always run one verification so that the response time does not reveal whether the user exists.
    $stored = $user['password'] ?? password_hash('dummy-password', PASSWORD_DEFAULT);
    $verified = password_verify($password, $stored);
    if ($user === null || !(bool) $user['enabled'] || !$verified) {
        fail('Неверный логин или пароль.', 401);
    }
    clearAttempts($key);
    $token = bin2hex(random_bytes(32));
    $csrf = bin2hex(random_bytes(32));
    transaction(function () use ($token, $csrf, $user) {
        query('DELETE FROM cms_sessions WHERE expires <= ?', [now()]);
        query('INSERT INTO cms_sessions (token, user_id, csrf, expires) VALUES (?, ?, ?, ?)',
            [hash('sha256', $token), $user['id'], $csrf, now() + SESSION_SECONDS]);
    });
    setSessionCookie($token, SESSION_SECONDS);
    return ['user' => ['username' => $user['username'], 'role' => $user['role']], 'csrf' => $csrf];
}

// ---------- layout ----------

function getLayout(): array
{
    $row = one("SELECT data, revision FROM cms_records WHERE id = 'site-layout' AND kind = 'layout'");
    $default = ['homeOrder' => HOME_MODULES, 'homeHidden' => [], 'homeCustom' => [], 'texts' => [], 'theme' => [], 'modules' => []];
    if ($row === null) {
        return ['revision' => 0, 'settings' => $default];
    }
    $data = json_decode($row['data'], true) ?: [];
    return ['revision' => (int) $row['revision'], 'settings' => $data['settings'] ?? $default];
}

function saveLayout(array $session, array $input): array
{
    $settings = validateLayout($input['settings'] ?? null);
    $revision = isset($input['revision']) ? (int) $input['revision'] : 0;
    $json = json_encode(['settings' => $settings], JSON_UNESCAPED_UNICODE);
    return transaction(function () use ($session, $json, $revision) {
        $row = one("SELECT revision FROM cms_records WHERE id = 'site-layout' AND kind = 'layout'" . lockSuffix());
        if ($row === null) {
            if ($revision !== 0) {
                fail('Настройки уже изменились. Обновите страницу.', 409);
            }
            query("INSERT INTO cms_records (id, kind, data, published, revision, updated_at, updated_by) VALUES ('site-layout', 'layout', ?, 1, 1, ?, ?)",
                [$json, now(), $session['id']]);
            return ['ok' => true, 'revision' => 1];
        }
        if ((int) $row['revision'] !== $revision) {
            fail('Настройки изменились у другого редактора. Обновите их перед сохранением.', 409);
        }
        query("UPDATE cms_records SET data = ?, revision = revision + 1, updated_at = ?, updated_by = ? WHERE id = 'site-layout' AND kind = 'layout'",
            [$json, now(), $session['id']]);
        return ['ok' => true, 'revision' => $revision + 1];
    });
}

// ---------- records ----------

function listRecords(): array
{
    return array_map(function (array $row) {
        $row['data'] = json_decode($row['data'], true) ?: [];
        $row['published'] = (int) $row['published'];
        $row['revision'] = (int) $row['revision'];
        $row['updated_at'] = (int) $row['updated_at'];
        return $row;
    }, all('SELECT * FROM cms_records ORDER BY updated_at DESC'));
}

function slugTaken(string $slug, string $exceptId): bool
{
    foreach (all("SELECT id, data FROM cms_records WHERE kind = 'news'") as $row) {
        if ($row['id'] !== $exceptId && (json_decode($row['data'], true)['slug'] ?? null) === $slug) {
            return true;
        }
    }
    return false;
}

function saveRecord(array $session, string $method, string $id, array $input): array
{
    $kind = $input['kind'] ?? null;
    if ($kind === 'contacts') {
        requireAdmin($session);
    }
    $data = validateRecord((string) $kind, $input['data'] ?? null);
    $published = ($input['published'] ?? null) === true ? 1 : 0;

    if ($kind === 'news' && slugTaken($data['slug'], $method === 'POST' ? '' : $id)) {
        fail('Адрес новости уже занят.', 409);
    }

    if ($method === 'POST') {
        $newId = $kind === 'contacts' ? 'contacts' : bin2hex(random_bytes(16));
        if (one('SELECT id FROM cms_records WHERE id = ?', [$newId])) {
            fail('Материал уже существует.', 409);
        }
        query('INSERT INTO cms_records (id, kind, data, published, revision, updated_at, updated_by) VALUES (?, ?, ?, ?, 1, ?, ?)',
            [$newId, $kind, json_encode($data, JSON_UNESCAPED_UNICODE), $published, now(), $session['id']]);
        return ['ok' => true, 'id' => $newId];
    }

    transaction(function () use ($session, $id, $kind, $data, $published, $input) {
        $existing = one('SELECT kind FROM cms_records WHERE id = ?' . lockSuffix(), [$id]);
        if ($existing === null) {
            fail('Материал не найден.', 404);
        }
        if ($existing['kind'] !== $kind) {
            fail('Нельзя менять раздел материала.');
        }
        if ($existing['kind'] === 'contacts') {
            requireAdmin($session);
        }
        if ($kind === 'events' && $data['registrationEnabled']) {
            $reserved = (int) (one("SELECT COALESCE(SUM(seats), 0) AS seats FROM cms_event_registrations WHERE event_id = ? AND status = 'confirmed'", [$id])['seats'] ?? 0);
            if ($data['capacity'] < $reserved) {
                fail('Новый лимит меньше числа уже записавшихся. Увеличьте лимит или отмените часть заявок.');
            }
        }
        $revision = isset($input['revision']) ? (int) $input['revision'] : -1;
        $current = one('SELECT revision FROM cms_records WHERE id = ?', [$id]);
        if ((int) $current['revision'] !== $revision) {
            fail('Материал изменён другим редактором. Обновите список перед сохранением.', 409);
        }
        query('UPDATE cms_records SET data = ?, published = ?, revision = revision + 1, updated_at = ?, updated_by = ? WHERE id = ?',
            [json_encode($data, JSON_UNESCAPED_UNICODE), $published, now(), $session['id'], $id]);
    });
    return ['ok' => true, 'id' => $id];
}

function deleteRecord(array $session, string $id): array
{
    transaction(function () use ($session, $id) {
        $record = one('SELECT kind FROM cms_records WHERE id = ?' . lockSuffix(), [$id]);
        if ($record === null) {
            fail('Материал не найден.', 404);
        }
        if ($record['kind'] === 'contacts') {
            requireAdmin($session);
        }
        if ($record['kind'] === 'events') {
            query('DELETE FROM cms_event_registrations WHERE event_id = ?', [$id]);
        }
        query('DELETE FROM cms_records WHERE id = ?', [$id]);
    });
    return ['ok' => true];
}

// ---------- registrations (admin view) ----------

function eventRegistrations(string $eventId): array
{
    $event = one("SELECT id, data FROM cms_records WHERE id = ? AND kind = 'events'", [$eventId]);
    if ($event === null) {
        fail('Мероприятие не найдено.', 404);
    }
    $data = json_decode($event['data'], true) ?: [];
    $rows = all('SELECT id, name, phone, seats, status, created_at FROM cms_event_registrations WHERE event_id = ? ORDER BY created_at DESC', [$eventId]);
    return [
        'eventId' => $eventId,
        'title' => $data['title'] ?? '',
        'capacity' => (int) ($data['capacity'] ?? 0),
        'registrations' => array_map(fn($r) => $r + ['seats' => (int) $r['seats'], 'created_at' => (int) $r['created_at']], $rows),
    ];
}

function cancelRegistration(string $id): array
{
    $statement = query("UPDATE cms_event_registrations SET status = 'cancelled' WHERE id = ? AND status = 'confirmed'", [$id]);
    if ($statement->rowCount() < 1) {
        fail('Заявка уже отменена или не найдена.', 404);
    }
    return ['ok' => true];
}

// ---------- users ----------

function listUsers(): array
{
    return array_map(fn($u) => $u + ['enabled' => (int) $u['enabled'], 'created_at' => (int) $u['created_at']],
        all('SELECT id, username, role, enabled, created_at FROM cms_users ORDER BY created_at'));
}

function createModerator(array $input): array
{
    if (!validUsername($input['username'] ?? null) || !validPassword($input['password'] ?? null)) {
        fail('Логин: 3–40 латинских букв, цифр, дефисов или подчёркиваний. Пароль: 10–128 символов.');
    }
    if (one('SELECT id FROM cms_users WHERE username = ?', [$input['username']])) {
        fail('Такой логин уже существует.', 409);
    }
    query("INSERT INTO cms_users (id, username, password, role, enabled, created_at) VALUES (?, ?, ?, 'moderator', 1, ?)",
        [bin2hex(random_bytes(16)), $input['username'], password_hash($input['password'], PASSWORD_DEFAULT), now()]);
    return ['ok' => true];
}

function updateUser(string $id, array $input): array
{
    $user = one('SELECT role FROM cms_users WHERE id = ?', [$id]);
    if ($user === null) {
        fail('Пользователь не найден.', 404);
    }
    if ($user['role'] === 'admin') {
        fail('Управление этим аккаунтом доступно через смену собственного пароля.');
    }
    $changes = 0;
    transaction(function () use ($id, $input, &$changes) {
        if (isset($input['enabled']) && is_bool($input['enabled'])) {
            query('UPDATE cms_users SET enabled = ? WHERE id = ?', [$input['enabled'] ? 1 : 0, $id]);
            $changes++;
        }
        if (array_key_exists('password', $input)) {
            if (!validPassword($input['password'])) {
                fail('Пароль должен содержать 10–128 символов.');
            }
            query('UPDATE cms_users SET password = ? WHERE id = ?', [password_hash($input['password'], PASSWORD_DEFAULT), $id]);
            $changes++;
        }
        if ($changes === 0) {
            fail('Нет изменений.');
        }
        query('DELETE FROM cms_sessions WHERE user_id = ?', [$id]);
    });
    return ['ok' => true];
}

function deleteUser(string $id): array
{
    $user = one('SELECT role FROM cms_users WHERE id = ?', [$id]);
    if ($user === null) {
        fail('Пользователь не найден.', 404);
    }
    if ($user['role'] === 'admin') {
        fail('Удаление администратора запрещено.');
    }
    transaction(function () use ($id) {
        query('DELETE FROM cms_sessions WHERE user_id = ?', [$id]);
        query('DELETE FROM cms_users WHERE id = ?', [$id]);
    });
    return ['ok' => true];
}

function changeOwnPassword(array $session, array $input): array
{
    $user = one('SELECT password FROM cms_users WHERE id = ?', [$session['id']]);
    $current = is_string($input['currentPassword'] ?? null) ? $input['currentPassword'] : '';
    if (!validPassword($input['password'] ?? null) || !password_verify($current, $user['password'] ?? '')) {
        fail('Проверьте текущий пароль. Новый пароль — от 10 символов.');
    }
    transaction(function () use ($session, $input) {
        query('UPDATE cms_users SET password = ? WHERE id = ?', [password_hash($input['password'], PASSWORD_DEFAULT), $session['id']]);
        query('DELETE FROM cms_sessions WHERE user_id = ?', [$session['id']]);
    });
    return ['ok' => true];
}
