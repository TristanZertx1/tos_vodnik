<?php
// Double opt-in newsletter subscriptions and signed one-click unsubscribe links.
declare(strict_types=1);

function ensureNewsletterSchema(): void
{
    $engine = driver() === 'sqlite' ? '' : ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4';
    db()->exec("CREATE TABLE IF NOT EXISTS cms_newsletter_subscribers (
        id VARCHAR(32) PRIMARY KEY,
        email VARCHAR(254) NOT NULL UNIQUE,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        confirm_token_hash VARCHAR(64) DEFAULT NULL,
        confirm_expires INT DEFAULT NULL,
        created_at INT NOT NULL,
        confirmed_at INT DEFAULT NULL,
        unsubscribed_at INT DEFAULT NULL
    )$engine");
}

function newsletterUnsubscribeToken(string $email): string
{
    $secret = (string) (config()['newsletter_secret'] ?? '');
    if (strlen($secret) < 32) {
        throw new RuntimeException('Newsletter signing secret is not configured.');
    }
    $address = strtolower(trim($email));
    $encoded = rtrim(strtr(base64_encode($address), '+/', '-_'), '=');
    return $encoded . '.' . hash_hmac('sha256', $address, $secret);
}

function newsletterUnsubscribeUrl(string $email): string
{
    return rtrim((string) config()['site_origin'], '/') . '/api/public/newsletter/unsubscribe?token=' . rawurlencode(newsletterUnsubscribeToken($email));
}

function subscribeNewsletter(array $input): array
{
    if (trim((string) ($input['website'] ?? '')) !== '') {
        return ['ok' => true];
    }
    if (!smtpIsConfigured()) {
        fail('Подписка временно настраивается. Попробуйте позже.', 503);
    }
    if (bumpAttempt(ipKey('newsletter-subscribe'), 3600) > 5) {
        fail('Слишком много попыток. Попробуйте позже.', 429);
    }
    $email = strtolower(trim((string) ($input['email'] ?? '')));
    if (strlen($email) > 254 || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
        fail('Укажите корректный адрес электронной почты.');
    }
    $existing = one('SELECT id, status FROM cms_newsletter_subscribers WHERE email = ?', [$email]);
    if ($existing !== null && $existing['status'] === 'active') {
        return ['ok' => true];
    }

    $id = $existing['id'] ?? bin2hex(random_bytes(16));
    $token = bin2hex(random_bytes(32));
    $time = now();
    if ($existing === null) {
        query(
            'INSERT INTO cms_newsletter_subscribers (id, email, status, confirm_token_hash, confirm_expires, created_at) VALUES (?, ?, ?, ?, ?, ?)',
            [$id, $email, 'pending', hash('sha256', $token), $time + 172800, $time]
        );
    } else {
        query(
            "UPDATE cms_newsletter_subscribers SET status = 'pending', confirm_token_hash = ?, confirm_expires = ?, confirmed_at = NULL, unsubscribed_at = NULL WHERE id = ?",
            [hash('sha256', $token), $time + 172800, $id]
        );
    }

    $confirmUrl = rtrim((string) config()['site_origin'], '/') . '/api/public/newsletter/confirm?token=' . rawurlencode($token);
    $body = "Здравствуйте!\n\nЧтобы подтвердить подписку на новости ТОС «Водники», перейдите по ссылке:\n{$confirmUrl}\n\nСсылка действует 48 часов. Если вы не оставляли заявку, просто проигнорируйте это письмо.\n";
    if (!sendSiteEmail($email, 'Подтверждение подписки на новости ТОС «Водники»', $body)) {
        fail('Не удалось отправить письмо подтверждения. Попробуйте позже или свяжитесь с ТОС.');
    }
    return ['ok' => true];
}

function confirmNewsletterSubscription(string $token): void
{
    if (!preg_match('/^[a-f0-9]{64}$/', $token)) {
        fail('Ссылка подтверждения недействительна.', 400);
    }
    $subscriber = one(
        "SELECT id FROM cms_newsletter_subscribers WHERE confirm_token_hash = ? AND status = 'pending' AND confirm_expires > ?",
        [hash('sha256', $token), now()]
    );
    if ($subscriber === null) {
        fail('Ссылка подтверждения недействительна или срок её действия истёк.', 400);
    }
    query(
        "UPDATE cms_newsletter_subscribers SET status = 'active', confirmed_at = ?, confirm_token_hash = NULL, confirm_expires = NULL WHERE id = ?",
        [now(), $subscriber['id']]
    );
}

function unsubscribeNewsletter(string $token): void
{
    $parts = explode('.', $token, 2);
    if (count($parts) !== 2 || !preg_match('/^[a-f0-9]{64}$/', $parts[1])) {
        fail('Ссылка отписки недействительна.', 400);
    }
    $encoded = strtr($parts[0], '-_', '+/');
    $padding = strlen($encoded) % 4;
    if ($padding) {
        $encoded .= str_repeat('=', 4 - $padding);
    }
    $email = base64_decode($encoded, true);
    if (!is_string($email) || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
        fail('Ссылка отписки недействительна.', 400);
    }
    $expected = hash_hmac('sha256', strtolower($email), (string) (config()['newsletter_secret'] ?? ''));
    if (!hash_equals($expected, $parts[1])) {
        fail('Ссылка отписки недействительна.', 400);
    }
    query(
        "UPDATE cms_newsletter_subscribers SET status = 'unsubscribed', unsubscribed_at = ?, confirm_token_hash = NULL, confirm_expires = NULL WHERE email = ?",
        [now(), strtolower($email)]
    );
}

function newsletterRedirect(string $status): never
{
    $origin = rtrim((string) config()['site_origin'], '/');
    header('Location: ' . $origin . '/podpiska?status=' . rawurlencode($status), true, 303);
    exit;
}

function notifyNewsletterSubscribers(string $kind, array $data): void
{
    $title = trim((string) ($data['title'] ?? 'Новая публикация'));
    $summary = trim(strip_tags((string) ($data['description'] ?? $data['excerpt'] ?? '')));
    $path = match ($kind) {
        'news' => '/novosti/' . rawurlencode((string) ($data['slug'] ?? '')),
        'events' => '/meropriyatiya',
        'projects' => '/proekty',
        'documents' => '/dokumenty',
        default => '/',
    };
    $url = rtrim((string) config()['site_origin'], '/') . $path;
    $subscribers = all("SELECT email FROM cms_newsletter_subscribers WHERE status = 'active' ORDER BY created_at");
    foreach ($subscribers as $subscriber) {
        $email = (string) $subscriber['email'];
        $unsubscribe = newsletterUnsubscribeUrl($email);
        $body = "Здравствуйте!\n\nНа сайте ТОС «Водники» опубликован новый материал:\n{$title}\n\n";
        if ($summary !== '') {
            $body .= mb_substr($summary, 0, 700) . "\n\n";
        }
        $body .= "Открыть публикацию: {$url}\n\nОтписаться от рассылки: {$unsubscribe}\n";
        sendSiteEmail($email, 'Новая публикация на сайте ТОС «Водники»', $body);
    }
}
