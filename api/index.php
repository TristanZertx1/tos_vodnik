<?php
// Single entry point for /api/*. The .htaccess in this folder routes every request here.
declare(strict_types=1);

require __DIR__ . '/lib/bootstrap.php';
require __DIR__ . '/lib/validate.php';
require __DIR__ . '/lib/cms.php';
require __DIR__ . '/lib/media.php';
require __DIR__ . '/lib/mailer.php';
require __DIR__ . '/lib/newsletter.php';
require __DIR__ . '/lib/community.php';

ini_set('display_errors', '0');

try {
    ensureCommunitySchema();
    $route = trim((string) ($_GET['route'] ?? ''), '/');
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    $parts = $route === '' ? [] : explode('/', $route);

    // ----- public -----
    if ($parts === ['public', 'content'] && $method === 'GET') {
        send(readPublic());
    }
    if ($parts === ['visit'] && $method === 'POST') {
        assertSameOrigin();
        recordPageView(jsonBody());
        http_response_code(204);
        exit;
    }
    if ($parts === ['public', 'newsletter', 'subscribe'] && $method === 'POST') {
        assertSameOrigin();
        send(subscribeNewsletter(jsonBody()));
    }
    if ($parts === ['public', 'newsletter', 'confirm'] && $method === 'GET') {
        confirmNewsletterSubscription((string) ($_GET['token'] ?? ''));
        newsletterRedirect('confirmed');
    }
    if ($parts === ['public', 'newsletter', 'unsubscribe'] && $method === 'GET') {
        newsletterUnsubscribePrompt((string) ($_GET['token'] ?? ''));
    }
    if ($parts === ['public', 'newsletter', 'unsubscribe'] && $method === 'POST') {
        assertSameOrigin();
        $input = jsonBody();
        unsubscribeNewsletter((string) ($input['token'] ?? ''));
        newsletterRedirect('unsubscribed');
    }
    if ($parts === ['public', 'ideas'] && $method === 'POST') {
        assertSameOrigin();
        send(submitCommunityIdea(jsonBody()), 201);
    }
    if (count($parts) === 4 && $parts[0] === 'public' && $parts[1] === 'events' && $parts[3] === 'register' && $method === 'POST') {
        if (!preg_match('/^[a-z0-9-]{12,40}$/i', $parts[2])) {
            fail('Мероприятие не найдено.', 404);
        }
        send(registerForEvent($parts[2], jsonBody()), 201);
    }

    // ----- admin -----
    if (($parts[0] ?? '') !== 'admin') {
        fail('Действие не найдено.', 404);
    }
    array_shift($parts);
    $action = implode('/', $parts);

    if ($action === 'login' && $method === 'POST') {
        send(login(jsonBody()));
    }
    if ($action === 'logout' && $method === 'POST') {
        $session = requireSession();
        requireCsrf($session);
        query('DELETE FROM cms_sessions WHERE token = ?', [$session['token']]);
        setSessionCookie('', 0);
        send(['ok' => true]);
    }

    $session = requireSession();

    if ($action === 'me' && $method === 'GET') {
        send(['user' => ['username' => $session['username'], 'role' => $session['role']], 'csrf' => $session['csrf']]);
    }

    if ($method !== 'GET') {
        requireCsrf($session);
    }

    if ($action === 'ideas' && $method === 'GET') {
        requireAdmin($session);
        send(listCommunityIdeas());
    }
    if (count($parts) === 2 && $parts[0] === 'ideas' && $method === 'PATCH') {
        requireAdmin($session);
        if (!preg_match('/^[a-f0-9]{32}$/', $parts[1])) {
            fail('Предложение не найдено.', 404);
        }
        send(updateCommunityIdea($parts[1], jsonBody()));
    }
    if (count($parts) === 2 && $parts[0] === 'ideas' && $method === 'DELETE') {
        requireAdmin($session);
        if (!preg_match('/^[a-f0-9]{32}$/', $parts[1])) {
            fail('Предложение не найдено.', 404);
        }
        send(deleteCommunityIdea($parts[1]));
    }
    if ($action === 'media' && $method === 'POST') {
        send(saveMedia($session), 201);
    }
    if ($action === 'media' && $method === 'GET') {
        send(listMedia());
    }
    if ($action === 'password' && $method === 'POST') {
        send(changeOwnPassword($session, jsonBody()));
    }
    if ($action === 'analytics' && $method === 'GET') {
        send(analytics());
    }
    if ($action === 'registrations' && $method === 'GET') {
        $eventId = (string) ($_GET['eventId'] ?? '');
        if (!preg_match('/^[a-z0-9-]{12,40}$/i', $eventId)) {
            fail('Выберите мероприятие.');
        }
        send(eventRegistrations($eventId));
    }
    if (count($parts) === 3 && $parts[0] === 'registrations' && $parts[2] === 'erase' && $method === 'DELETE') {
        requireAdmin($session);
        if (!preg_match('/^[a-z0-9-]{12,40}$/i', $parts[1])) {
            fail('Заявка не найдена.', 404);
        }
        send(eraseCancelledRegistration($parts[1]));
    }
    if (count($parts) === 2 && $parts[0] === 'registrations' && $method === 'DELETE') {
        if (!preg_match('/^[a-z0-9-]{12,40}$/i', $parts[1])) {
            fail('Заявка не найдена.', 404);
        }
        send(cancelRegistration($parts[1]));
    }
    if ($action === 'layout' && $method === 'GET') {
        send(getLayout());
    }
    if ($action === 'layout' && $method === 'PUT') {
        send(saveLayout($session, jsonBody(200000)));
    }
    if ($action === 'users' && $method === 'GET') {
        requireAdmin($session);
        send(listUsers());
    }
    if ($action === 'users' && $method === 'POST') {
        requireAdmin($session);
        send(createModerator(jsonBody()), 201);
    }
    if (count($parts) === 2 && $parts[0] === 'users' && $method === 'PATCH') {
        requireAdmin($session);
        send(updateUser($parts[1], jsonBody()));
    }
    if (count($parts) === 2 && $parts[0] === 'users' && $method === 'DELETE') {
        requireAdmin($session);
        send(deleteUser($parts[1]));
    }
    if ($action === 'records' && $method === 'GET') {
        send(listRecords());
    }
    if ($action === 'records' && $method === 'POST') {
        send(saveRecord($session, 'POST', '', jsonBody(1000000)), 201);
    }
    if (count($parts) === 2 && $parts[0] === 'records' && $method === 'PUT') {
        send(saveRecord($session, 'PUT', $parts[1], jsonBody(1000000)));
    }
    if (count($parts) === 2 && $parts[0] === 'records' && $method === 'DELETE') {
        send(deleteRecord($session, $parts[1]));
    }

    fail('Действие не найдено.', 404);
} catch (ApiError $error) {
    sendError($error);
} catch (Throwable $error) {
    error_log('[api] ' . $error->getMessage() . ' in ' . $error->getFile() . ':' . $error->getLine());
    send(['error' => 'Не удалось выполнить действие. Повторите позже.'], 500);
}
