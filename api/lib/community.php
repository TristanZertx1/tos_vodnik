<?php
// Public resident ideas and administrator moderation.
declare(strict_types=1);

function ensureCommunitySchema(): void
{
    $engine = driver() === 'sqlite' ? '' : ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4';
    db()->exec("CREATE TABLE IF NOT EXISTS cms_ideas (
        id VARCHAR(32) PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(254) NOT NULL DEFAULT '',
        category VARCHAR(40) NOT NULL,
        location VARCHAR(180) NOT NULL DEFAULT '',
        description TEXT NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'new',
        consent_at INT NOT NULL,
        created_at INT NOT NULL
    )$engine");
}

function submitCommunityIdea(array $input): array
{
    // Honeypot: respond as if accepted, without storing automated submissions.
    if (trim((string) ($input['website'] ?? '')) !== '') {
        return ['ok' => true];
    }

    if (bumpAttempt('community-idea:' . hash('sha256', clientIp()), 3600) > 4) {
        fail('Слишком много отправок. Попробуйте ещё раз через час.', 429);
    }

    $name = trim((string) ($input['name'] ?? ''));
    $email = trim((string) ($input['email'] ?? ''));
    $category = (string) ($input['category'] ?? '');
    $location = trim((string) ($input['location'] ?? ''));
    $description = trim((string) ($input['description'] ?? ''));
    $categories = ['Благоустройство', 'Общественные пространства', 'Мероприятия', 'Культура и спорт', 'Безопасность', 'Другое'];

    if (mb_strlen($name) < 2 || mb_strlen($name) > 100) {
        fail('Укажите имя длиной от 2 до 100 символов.');
    }
    if (!in_array($category, $categories, true)) {
        fail('Выберите категорию предложения.');
    }
    if (mb_strlen($location) > 180) {
        fail('Уточнение места не должно превышать 180 символов.');
    }
    if (mb_strlen($description) < 20 || mb_strlen($description) > 3000) {
        fail('Описание должно содержать от 20 до 3000 символов.');
    }
    if ($email !== '' && (strlen($email) > 254 || filter_var($email, FILTER_VALIDATE_EMAIL) === false)) {
        fail('Проверьте адрес электронной почты.');
    }
    if (($input['consent'] ?? false) !== true) {
        fail('Необходимо согласие на обработку персональных данных.');
    }

    $id = bin2hex(random_bytes(16));
    $time = now();
    query(
        'INSERT INTO cms_ideas (id, name, email, category, location, description, status, consent_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [$id, $name, $email, $category, $location, $description, 'new', $time, $time]
    );

    return ['ok' => true, 'id' => $id];
}

function listCommunityIdeas(): array
{
    return ['items' => all('SELECT id, name, email, category, location, description, status, consent_at, created_at FROM cms_ideas ORDER BY created_at DESC')];
}

function updateCommunityIdea(string $id, array $input): array
{
    $status = (string) ($input['status'] ?? '');
    $allowed = ['new', 'in_review', 'approved', 'rejected', 'done'];
    if (!in_array($status, $allowed, true)) {
        fail('Выберите допустимый статус предложения.');
    }
    $statement = query('UPDATE cms_ideas SET status = ? WHERE id = ?', [$status, $id]);
    if ($statement->rowCount() < 1 && one('SELECT id FROM cms_ideas WHERE id = ?', [$id]) === null) {
        fail('Предложение не найдено.', 404);
    }
    return ['ok' => true];
}

function deleteCommunityIdea(string $id): array
{
    $statement = query('DELETE FROM cms_ideas WHERE id = ?', [$id]);
    if ($statement->rowCount() < 1) {
        fail('Предложение не найдено.', 404);
    }
    return ['ok' => true];
}
