<?php
// Minimal SMTP client for the site's own mailbox. Credentials live only in api/config.php.
declare(strict_types=1);

function smtpIsConfigured(): bool
{
    $smtp = config()['smtp'] ?? [];
    return is_array($smtp)
        && trim((string) ($smtp['host'] ?? '')) !== ''
        && (int) ($smtp['port'] ?? 0) > 0
        && trim((string) ($smtp['username'] ?? '')) !== ''
        && (string) ($smtp['password'] ?? '') !== ''
        && filter_var((string) (config()['mail_from'] ?? ''), FILTER_VALIDATE_EMAIL) !== false;
}

function smtpRead($socket, array $expected): string
{
    $response = '';
    do {
        $line = fgets($socket, 515);
        if ($line === false) {
            throw new RuntimeException('SMTP server closed the connection.');
        }
        $response .= $line;
    } while (isset($line[3]) && $line[3] === '-');

    $code = (int) substr($line, 0, 3);
    if (!in_array($code, $expected, true)) {
        throw new RuntimeException('SMTP command failed with response ' . $code . '.');
    }
    return $response;
}

function smtpCommand($socket, string $command, array $expected): string
{
    if (fwrite($socket, $command . "\r\n") === false) {
        throw new RuntimeException('Unable to write to SMTP server.');
    }
    return smtpRead($socket, $expected);
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
        throw new RuntimeException('Unable to connect to SMTP server: ' . $error . ' (' . $errno . ').');
    }

    try {
        stream_set_timeout($socket, 20);
        smtpRead($socket, [220]);
        $domain = (string) (parse_url((string) ($cfg['site_origin'] ?? ''), PHP_URL_HOST) ?: 'localhost');
        smtpCommand($socket, 'EHLO ' . preg_replace('/[^a-z0-9.-]/i', '', $domain), [250]);

        if ($encryption === 'starttls' || $encryption === 'tls') {
            smtpCommand($socket, 'STARTTLS', [220]);
            $crypto = stream_socket_enable_crypto($socket, true, STREAM_CRYPTO_METHOD_TLS_CLIENT);
            if ($crypto !== true) {
                throw new RuntimeException('Unable to establish TLS with SMTP server.');
            }
            smtpCommand($socket, 'EHLO ' . preg_replace('/[^a-z0-9.-]/i', '', $domain), [250]);
        }

        smtpCommand($socket, 'AUTH LOGIN', [334]);
        smtpCommand($socket, base64_encode($username), [334]);
        smtpCommand($socket, base64_encode($password), [235]);
        smtpCommand($socket, 'MAIL FROM:<' . $from . '>', [250]);
        smtpCommand($socket, 'RCPT TO:<' . $to . '>', [250, 251]);
        smtpCommand($socket, 'DATA', [354]);

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
        if (fwrite($socket, $message . "\r\n.\r\n") === false) {
            throw new RuntimeException('Unable to send email body.');
        }
        smtpRead($socket, [250]);
        smtpCommand($socket, 'QUIT', [221, 250]);
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
