<?php
// Minimal SMTP client for the site's own mailbox. Credentials live only in api/config.php.
declare(strict_types=1);

function smtpIsConfigured(): bool
{
    $smtp = config()['smtp'] ?? [];
    if (!is_array($smtp)) {
        return false;
    }
    $encryption = strtolower((string) ($smtp['encryption'] ?? 'ssl'));
    return in_array($encryption, ['ssl', 'tls', 'starttls'], true)
        && trim((string) ($smtp['host'] ?? '')) !== ''
        && (int) ($smtp['port'] ?? 0) > 0
        && trim((string) ($smtp['username'] ?? '')) !== ''
        && (string) ($smtp['password'] ?? '') !== ''
        && filter_var((string) (config()['mail_from'] ?? ''), FILTER_VALIDATE_EMAIL) !== false;
}

/**
 * Read one complete SMTP reply. Log only the stage and numeric response code:
 * server reply text can contain mailbox addresses or other personal data.
 */
function smtpRead($socket, array $expected, string $stage = 'command'): string
{
    $response = '';
    do {
        $line = fgets($socket, 515);
        if ($line === false) {
            $metadata = stream_get_meta_data($socket);
            if (!empty($metadata['timed_out'])) {
                throw new RuntimeException('SMTP ' . $stage . ' timed out while waiting for server response.');
            }
            throw new RuntimeException('SMTP ' . $stage . ' failed: server closed the connection.');
        }
        $response .= $line;
    } while (isset($line[3]) && $line[3] === '-');

    if (!preg_match('/^(\d{3})[ -]/', $line, $matches)) {
        throw new RuntimeException('SMTP ' . $stage . ' failed: malformed server response.');
    }

    $code = (int) $matches[1];
    if (!in_array($code, $expected, true)) {
        throw new RuntimeException('SMTP ' . $stage . ' failed with response ' . $code . '.');
    }
    return $response;
}

/** Write the entire command or message, handling partial socket writes. */
function smtpWriteAll($socket, string $data, string $stage): void
{
    $length = strlen($data);
    $written = 0;
    while ($written < $length) {
        $result = fwrite($socket, substr($data, $written));
        if ($result === false || $result === 0) {
            $metadata = stream_get_meta_data($socket);
            $reason = !empty($metadata['timed_out']) ? ' timed out' : ' failed';
            throw new RuntimeException('SMTP ' . $stage . ' write' . $reason . '.');
        }
        $written += $result;
    }
}

function smtpCommand($socket, string $command, array $expected, string $stage = 'command'): string
{
    smtpWriteAll($socket, $command . "\r\n", $stage);
    return smtpRead($socket, $expected, $stage);
}

function smtpSendMail(string $to, string $subject, string $body): void
{
    if (!smtpIsConfigured()) {
        throw new RuntimeException('SMTP is not configured.');
    }
    if (filter_var($to, FILTER_VALIDATE_EMAIL) === false) {
        throw new RuntimeException('Invalid email recipient.');
    }

    $cfg = config();
    $smtp = $cfg['smtp'];
    $host = trim((string) $smtp['host']);
    $port = (int) $smtp['port'];
    $encryption = strtolower((string) ($smtp['encryption'] ?? 'ssl'));
    $username = (string) $smtp['username'];
    $password = (string) $smtp['password'];
    $from = (string) $cfg['mail_from'];
    $scheme = $encryption === 'ssl' ? 'ssl://' : 'tcp://';
    $context = stream_context_create(['ssl' => [
        'verify_peer' => true,
        'verify_peer_name' => true,
        'peer_name' => $host,
    ]]);
    $socket = @stream_socket_client($scheme . $host . ':' . $port, $errno, $error, 20, STREAM_CLIENT_CONNECT, $context);
    if ($socket === false) {
        throw new RuntimeException('Unable to connect to SMTP server (connection error ' . $errno . ').');
    }

    try {
        stream_set_timeout($socket, 20);
        smtpRead($socket, [220], 'connection greeting');
        $domain = (string) (parse_url((string) ($cfg['site_origin'] ?? ''), PHP_URL_HOST) ?: 'localhost');
        $ehlo = 'EHLO ' . preg_replace('/[^a-z0-9.-]/i', '', $domain);
        smtpCommand($socket, $ehlo, [250], 'EHLO');

        if ($encryption === 'starttls' || $encryption === 'tls') {
            smtpCommand($socket, 'STARTTLS', [220], 'STARTTLS');
            $crypto = @stream_socket_enable_crypto($socket, true, STREAM_CRYPTO_METHOD_TLS_CLIENT);
            if ($crypto !== true) {
                throw new RuntimeException('SMTP TLS negotiation failed.');
            }
            smtpCommand($socket, $ehlo, [250], 'EHLO after STARTTLS');
        }

        smtpCommand($socket, 'AUTH LOGIN', [334], 'AUTH LOGIN');
        smtpCommand($socket, base64_encode($username), [334], 'AUTH username');
        smtpCommand($socket, base64_encode($password), [235], 'AUTH password');
        smtpCommand($socket, 'MAIL FROM:<' . $from . '>', [250], 'MAIL FROM');
        smtpCommand($socket, 'RCPT TO:<' . $to . '>', [250, 251], 'RCPT TO');
        smtpCommand($socket, 'DATA', [354], 'DATA');

        $encodedSubject = '=?UTF-8?B?' . base64_encode(str_replace(["\r", "\n"], '', $subject)) . '?=';
        $encodedFrom = '=?UTF-8?B?' . base64_encode('ТОС «Водники»') . '?=';
        $headers = [
            'From: ' . $encodedFrom . ' <' . $from . '>',
            'To: ' . $to,
            'Subject: ' . $encodedSubject,
            'MIME-Version: 1.0',
            'Content-Type: text/plain; charset=UTF-8',
            'Content-Transfer-Encoding: 8bit',
        ];
        $message = implode("\r\n", $headers) . "\r\n\r\n";
        $message .= preg_replace('/(?m)^\./', '..', str_replace(["\r\n", "\r"], "\n", $body));
        $message = str_replace("\n", "\r\n", $message);
        smtpWriteAll($socket, $message . "\r\n.\r\n", 'message body');
        smtpRead($socket, [250], 'message acceptance');

        // The server has accepted the message; a later QUIT failure must not mark it unsent.
        try {
            smtpCommand($socket, 'QUIT', [221, 250], 'QUIT');
        } catch (Throwable $error) {
            error_log('[mail] SMTP QUIT failed after message acceptance.');
        }
    } finally {
        fclose($socket);
    }
}

/** Email failures must never undo a successfully saved form or publication. */
function sendSiteEmail(string $to, string $subject, string $body): bool
{
    try {
        if (smtpIsConfigured()) {
            smtpSendMail($to, $subject, $body);
            return true;
        }
        $from = (string) (config()['mail_from'] ?? '');
        if ($from !== '' && filter_var($from, FILTER_VALIDATE_EMAIL) !== false) {
            return @mail($to, '=?UTF-8?B?' . base64_encode($subject) . '?=', $body, "From: {$from}\r\nContent-Type: text/plain; charset=UTF-8");
        }
    } catch (Throwable $error) {
        error_log('[mail] ' . $error->getMessage());
    }
    return false;
}
