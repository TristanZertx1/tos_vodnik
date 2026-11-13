<?php
// The one-time installer was retired. Keep this inert endpoint in deployments so
// an older server-side copy is overwritten instead of remaining executable.
declare(strict_types=1);

http_response_code(404);
header('Content-Type: text/plain; charset=utf-8');
header('X-Robots-Tag: noindex, nofollow');
exit;
