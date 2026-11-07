<?php
// Uploads for news and event photos and videos. Files go to <site>/uploads/media, not into the database.
declare(strict_types=1);

const MEDIA_IMAGE_TYPES = [
    'image/jpeg' => 'jpg',
    'image/png' => 'png',
    'image/webp' => 'webp',
];
const MEDIA_VIDEO_TYPES = [
    'video/mp4' => 'mp4',
    'video/webm' => 'webm',
];
const MEDIA_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const MEDIA_VIDEO_MAX_BYTES = 60 * 1024 * 1024;

function mediaDirectory(): string
{
    // api/lib -> site root/uploads/media
    return dirname(__DIR__, 2) . '/uploads/media';
}

function ensureMediaDirectory(): string
{
    $dir = mediaDirectory();
    if (!is_dir($dir) && !mkdir($dir, 0755, true) && !is_dir($dir)) {
        fail('Не удалось создать папку для файлов. Проверьте права на папку uploads.', 500);
    }
    $guard = dirname($dir) . '/.htaccess';
    if (!is_file($guard)) {
        // Uploaded files are data only: never run them as PHP or list the folder.
        file_put_contents($guard, "Options -Indexes\n<FilesMatch \"\\.(php\\d?|phtml|phar|pl|py|cgi|sh)$\">\n  Require all denied\n</FilesMatch>\n");
    }
    return $dir;
}

function saveMedia(array $session): array
{
    $kind = (string) ($_POST['kind'] ?? '');
    if (!in_array($kind, ['image', 'video'], true)) {
        fail('Выберите тип файла: фото или видео.');
    }
    $file = $_FILES['file'] ?? null;
    if (!is_array($file)) {
        fail('Файл не получен. Возможно, он больше допустимого размера сервера.', 413);
    }
    if (($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        if (in_array($file['error'], [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true)) {
            fail('Файл слишком большой для сервера. Фото — до 10 МБ, видео — до 60 МБ, видео сожмите в MP4.', 413);
        }
        fail('Не удалось загрузить файл. Попробуйте ещё раз.');
    }
    $tmp = (string) $file['tmp_name'];
    if (!is_uploaded_file($tmp)) {
        fail('Файл не получен.');
    }
    $size = (int) $file['size'];
    $mime = (string) (new finfo(FILEINFO_MIME_TYPE))->file($tmp);

    if ($kind === 'image') {
        if (!isset(MEDIA_IMAGE_TYPES[$mime])) {
            fail('Фото должно быть в формате JPEG, PNG или WebP.');
        }
        if ($size > MEDIA_IMAGE_MAX_BYTES) {
            fail('Фото слишком большое: максимум 10 МБ.');
        }
        $ext = MEDIA_IMAGE_TYPES[$mime];
        $dir = ensureMediaDirectory();
        $name = bin2hex(random_bytes(16)) . '.' . $ext;
        $target = $dir . '/' . $name;
        // Re-encode with GD: this strips EXIF (including GPS) and proves the file is a real image.
        if (!function_exists('imagecreatefromstring')) {
            fail('На сервере не включена библиотека GD. Обратитесь к хостингу.', 500);
        }
        $source = @imagecreatefromstring((string) file_get_contents($tmp));
        if ($source === false) {
            fail('Не удалось прочитать фото. Загрузите другой файл.');
        }
        $ok = match ($ext) {
            'jpg' => imagejpeg($source, $target, 88),
            'png' => imagepng($source, $target, 6),
            'webp' => function_exists('imagewebp') && imagewebp($source, $target, 88),
        };
        imagedestroy($source);
        if (!$ok || !is_file($target)) {
            @unlink($target);
            fail('Не удалось сохранить фото. Попробуйте JPEG или PNG.', 500);
        }
    } else {
        if (!isset(MEDIA_VIDEO_TYPES[$mime])) {
            fail('Видео должно быть в формате MP4 или WebM.');
        }
        if ($size > MEDIA_VIDEO_MAX_BYTES) {
            fail('Видео слишком большое: максимум 60 МБ. Сожмите его в MP4.');
        }
        $ext = MEDIA_VIDEO_TYPES[$mime];
        $dir = ensureMediaDirectory();
        $name = bin2hex(random_bytes(16)) . '.' . $ext;
        $target = $dir . '/' . $name;
        if (!move_uploaded_file($tmp, $target)) {
            fail('Не удалось сохранить видео. Проверьте права на папку uploads.', 500);
        }
    }

    return ['url' => '/uploads/media/' . $name, 'kind' => $kind, 'size' => $size];
}

/**
 * Every photo and video uploaded through the admin, newest first, with the path the site uses for it.
 * Only files matching the upload naming scheme are listed.
 */
function listMedia(): array
{
    $dir = mediaDirectory();
    if (!is_dir($dir)) {
        return ['items' => []];
    }
    $items = [];
    foreach (scandir($dir) ?: [] as $name) {
        if (!preg_match('#^[a-f0-9]{32}\.(jpg|png|webp|mp4|webm)$#', $name, $m)) {
            continue;
        }
        $path = $dir . '/' . $name;
        if (!is_file($path)) {
            continue;
        }
        $items[] = [
            'name' => $name,
            'url' => '/uploads/media/' . $name,
            'kind' => in_array($m[1], ['mp4', 'webm'], true) ? 'video' : 'image',
            'size' => (int) filesize($path),
            'uploadedAt' => gmdate('c', (int) filemtime($path)),
        ];
    }
    usort($items, static fn(array $a, array $b): int => strcmp($b['uploadedAt'], $a['uploadedAt']));
    return ['items' => $items];
}

