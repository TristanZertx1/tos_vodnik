<?php
// Common infrastructure for the ТОС «Водники» API: configuration, database, JSON helpers.
declare(strict_types=1);

date_default_timezone_set('Asia/Yekaterinburg');

final class ApiError extends RuntimeException
{
    public function __construct(string $message, public readonly int $status = 400)
    {
        parent::__construct($message);
    }
}

function fail(string $message, int $status = 400): never
{
    throw new ApiError($message, $status);
}

function config(): array
{
    static $config = null;
    if ($config === null) {
        $file = __DIR__ . '/../config.php';
        if (!is_file($file)) {
            throw new ApiError('Сервер не настроен: отсутствует api/config.php.', 503);
        }
        $config = require $file;
    }
    return $config;
}

function now(): int
{
    return time();
}

function db(): PDO
{
    static $pdo = null;
    if ($pdo !== null) {
        return $pdo;
    }
    $cfg = config()['db'];
    if (($cfg['driver'] ?? 'mysql') === 'sqlite') {
        $pdo = new PDO('sqlite:' . $cfg['path']);
        $pdo->exec('PRAGMA foreign_keys = ON');
    } else {
        $dsn = sprintf('mysql:host=%s;dbname=%s;charset=utf8mb4', $cfg['host'], $cfg['name']);
        $pdo = new PDO($dsn, $cfg['user'], $cfg['pass']);
    }
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    $pdo->setAttribute(PDO::ATTR_EMULATE_PREPARES, false);
    return $pdo;
}

function driver(): string
{
    return config()['db']['driver'] ?? 'mysql';
}

/** Row-locking suffix: MySQL supports it, SQLite serialises writes anyway. */
function lockSuffix(): string
{
    return driver() === 'sqlite' ? '' : ' FOR UPDATE';
}

function query(string $sql, array $params = []): PDOStatement
{
    $statement = db()->prepare($sql);
    $statement->execute($params);
    return $statement;
}

function one(string $sql, array $params = []): ?array
{
    $row = query($sql, $params)->fetch();
    return $row ?: null;
}

function all(string $sql, array $params = []): array
{
    return query($sql, $params)->fetchAll();
}

function transaction(callable $work): mixed
{
    $pdo = db();
    $pdo->beginTransaction();
    try {
        $result = $work();
        $pdo->commit();
        return $result;
    } catch (Throwable $error) {
        $pdo->rollBack();
        throw $error;
    }
}

/** Increments a counter-like row for rate limiting. Returns the stored count after the update. */
function bumpAttempt(string $key, int $windowSeconds): int
{
    return transaction(function () use ($key, $windowSeconds) {
        $time = now();
        $row = one('SELECT `count`, reset_at FROM cms_attempts WHERE `key` = ?' . lockSuffix(), [$key]);
        if ($row === null) {
            query('INSERT INTO cms_attempts (`key`, `count`, reset_at) VALUES (?, 1, ?)', [$key, $time + $windowSeconds]);
            return 1;
        }
        if ((int) $row['reset_at'] <= $time) {
            query('UPDATE cms_attempts SET `count` = 1, reset_at = ? WHERE `key` = ?', [$time + $windowSeconds, $key]);
            return 1;
        }
        query('UPDATE cms_attempts SET `count` = `count` + 1 WHERE `key` = ?', [$key]);
        return (int) $row['count'] + 1;
    });
}

function attemptCount(string $key): int
{
    $row = one('SELECT `count`, reset_at FROM cms_attempts WHERE `key` = ?', [$key]);
    if ($row === null || (int) $row['reset_at'] <= now()) {
        return 0;
    }
    return (int) $row['count'];
}

function clearAttempts(string $key): void
{
    query('DELETE FROM cms_attempts WHERE `key` = ?', [$key]);
}

/** Client IP as seen by the web server. X-Forwarded-For is client-controlled and is not trusted. */
function clientIp(): string
{
    return (string) ($_SERVER['REMOTE_ADDR'] ?? 'unknown');
}

function ipKey(string $scope): string
{
    return $scope . ':' . hash('sha256', clientIp());
}

function requestOrigin(): string
{
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['SERVER_PORT'] ?? '') == 443);
    return ($https ? 'https' : 'http') . '://' . ($_SERVER['HTTP_HOST'] ?? 'localhost');
}

/** Write requests must come from this site. */
function assertSameOrigin(): void
{
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    $allowed = [requestOrigin(), rtrim((string) (config()['site_origin'] ?? ''), '/')];
    if ($origin === '' || !in_array($origin, $allowed, true)) {
        fail('Запрос с другого сайта запрещён.', 403);
    }
}

function jsonBody(int $maxBytes = 50000): array
{
    $type = $_SERVER['CONTENT_TYPE'] ?? '';
    if (!str_starts_with($type, 'application/json')) {
        fail('Нужен формат JSON.', 415);
    }
    $raw = file_get_contents('php://input', false, null, 0, $maxBytes + 1);
    if ($raw === false || strlen($raw) > $maxBytes) {
        fail('Материал слишком большой. Уменьшите фотографии или текст.', 413);
    }
    $value = json_decode($raw, true);
    if (!is_array($value) || array_is_list($value)) {
        fail('Неверный формат данных.');
    }
    return $value;
}

function send(mixed $data, int $status = 200, array $headers = []): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    foreach ($headers as $name => $value) {
        header($name . ': ' . $value);
    }
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION);
    exit;
}

function sendError(ApiError $error): never
{
    send(['error' => $error->getMessage()], $error->status);
}

/** Creates tables if they do not exist. Works for MySQL (production) and SQLite (local tests). */
function installSchema(): void
{
    $engine = driver() === 'sqlite' ? '' : ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4';
    $statements = [
        "CREATE TABLE IF NOT EXISTS cms_users (
            id VARCHAR(64) PRIMARY KEY,
            username VARCHAR(40) NOT NULL UNIQUE,
            password VARCHAR(255) NOT NULL,
            role VARCHAR(20) NOT NULL,
            enabled INT NOT NULL DEFAULT 1,
            created_at INT NOT NULL
        )$engine",
        "CREATE TABLE IF NOT EXISTS cms_sessions (
            token VARCHAR(64) PRIMARY KEY,
            user_id VARCHAR(64) NOT NULL,
            csrf VARCHAR(64) NOT NULL,
            expires INT NOT NULL
        )$engine",
        "CREATE TABLE IF NOT EXISTS cms_records (
            id VARCHAR(64) PRIMARY KEY,
            kind VARCHAR(20) NOT NULL,
            data LONGTEXT NOT NULL,
            published INT NOT NULL DEFAULT 0,
            revision INT NOT NULL DEFAULT 1,
            updated_at INT NOT NULL,
            updated_by VARCHAR(64) NOT NULL
        )$engine",
        "CREATE TABLE IF NOT EXISTS cms_attempts (
            `key` VARCHAR(128) PRIMARY KEY,
            `count` INT NOT NULL DEFAULT 0,
            reset_at INT NOT NULL
        )$engine",
        "CREATE TABLE IF NOT EXISTS cms_event_registrations (
            id VARCHAR(64) PRIMARY KEY,
            event_id VARCHAR(64) NOT NULL,
            name VARCHAR(120) NOT NULL,
            phone VARCHAR(32) NOT NULL,
            seats INT NOT NULL DEFAULT 1,
            status VARCHAR(20) NOT NULL DEFAULT 'confirmed',
            created_at INT NOT NULL,
            consent_at INT NOT NULL,
            UNIQUE (event_id, phone)
        )$engine",
        "CREATE TABLE IF NOT EXISTS cms_page_views (
            day VARCHAR(10) NOT NULL,
            path VARCHAR(190) NOT NULL,
            views INT NOT NULL DEFAULT 0,
            PRIMARY KEY (day, path)
        )$engine",
        "CREATE TABLE IF NOT EXISTS cms_meta (
            `key` VARCHAR(100) PRIMARY KEY,
            value TEXT NOT NULL
        )$engine",
    ];
    foreach ($statements as $sql) {
        db()->exec($sql);
    }
}
