<?php
// Validation rules for CMS records and site layout. Ported from lib/cms.ts.
declare(strict_types=1);

const KINDS = ['news', 'events', 'projects', 'documents', 'contacts'];
const HOME_MODULES = ['hero', 'quick', 'overview', 'news', 'events', 'projects', 'join'];
const EDITABLE_PAGES = ['/', '/o-tos/', '/novosti/', '/meropriyatiya/', '/proekty/', '/dokumenty/', '/kontakty/'];
const PAGE_MODULES = [
    '/' => HOME_MODULES,
    '/o-tos/' => ['about-heading', 'about-nav', 'about-intro', 'about-directions', 'about-chairperson', 'about-clubs', 'about-participate', 'about-activity-2025', 'about-activity-2024', 'about-faq'],
    '/novosti/' => ['news-heading', 'news-content'],
    '/meropriyatiya/' => ['events-heading', 'events-content'],
    '/proekty/' => ['projects-heading', 'projects-content'],
    '/dokumenty/' => ['documents-heading', 'documents-content'],
    '/kontakty/' => ['contacts-heading', 'contacts-content'],
];

function validUsername(mixed $value): bool
{
    return is_string($value) && preg_match('/^[a-z0-9][a-z0-9_-]{2,39}$/', $value) === 1;
}

function validPassword(mixed $value): bool
{
    return is_string($value) && mb_strlen($value) >= 10 && mb_strlen($value) <= 128;
}

function validEmail(string $value): bool
{
    return preg_match('/^[^\s@]+@[^\s@]+\.[^\s@]+$/u', $value) === 1;
}

function validIsoDate(string $value): bool
{
    if (!preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $value, $m)) {
        return false;
    }
    return checkdate((int) $m[2], (int) $m[3], (int) $m[1]);
}

function isHttpUrl(string $value): bool
{
    if (filter_var($value, FILTER_VALIDATE_URL) === false) {
        return false;
    }
    $scheme = strtolower((string) parse_url($value, PHP_URL_SCHEME));
    return $scheme === 'http' || $scheme === 'https';
}

/** Text field length limit in characters (the front end counts UTF-16 units; close enough for limits). */
function textLength(string $value): int
{
    return mb_strlen($value);
}

function validateRecord(string $kind, mixed $source): array
{
    if (!in_array($kind, KINDS, true) || !is_array($source)) {
        fail('Неверный раздел.');
    }
    $fields = [
        'news' => ['title', 'slug', 'date', 'category', 'description', 'body', 'source', 'image', 'imageAlt', 'images'],
        'events' => ['title', 'date', 'time', 'place', 'description', 'participation', 'source', 'capacity', 'registrationEnabled'],
        'projects' => ['title', 'status', 'description', 'results', 'participation', 'image', 'imageAlt', 'source'],
        'documents' => ['title', 'date', 'format', 'size', 'url'],
        'contacts' => ['phone', 'email', 'hours', 'source'],
    ][$kind];

    $data = [];
    foreach ($fields as $field) {
        if (($kind === 'news' && $field === 'images') || ($kind === 'events' && in_array($field, ['capacity', 'registrationEnabled'], true))) {
            continue;
        }
        $value = $source[$field] ?? '';
        $limit = in_array($field, ['body', 'description'], true) ? 20000 : 1000;
        if (!is_string($value) || textLength($value) > $limit) {
            fail('Проверьте текстовые поля.');
        }
        $data[$field] = trim($value);
    }

    if ($kind === 'events') {
        $enabled = ($source['registrationEnabled'] ?? null) === true;
        $capacityRaw = $source['capacity'] ?? '';
        if ($capacityRaw === '' || $capacityRaw === null) {
            $capacity = 0;
        } elseif (!is_numeric($capacityRaw) || (float) $capacityRaw !== (float) (int) $capacityRaw) {
            fail('Лимит мест должен быть целым числом от 1 до 500.');
        } else {
            $capacity = (int) $capacityRaw;
        }
        if ($capacity < 0 || $capacity > 500) {
            fail('Лимит мест должен быть целым числом от 1 до 500.');
        }
        if ($enabled && $capacity < 1) {
            fail('Укажите вместимость, чтобы открыть запись.');
        }
        $data['registrationEnabled'] = $enabled;
        $data['capacity'] = $capacity;
    }

    if ($kind === 'news' || $kind === 'events') {
        [$images, $videos] = validateMedia($source);
        $data['images'] = $images;
        $data['videos'] = $videos;
        if (($images !== [] || $videos !== []) && ($source['imagePermission'] ?? null) !== true) {
            fail('Подтвердите право на размещение фото и видео.');
        }
        if ($images !== [] || $videos !== []) {
            $data['imagePermission'] = true;
        }
    }

    $required = [
        'news' => ['title', 'slug', 'date', 'category', 'description'],
        'events' => ['title', 'date', 'time', 'place', 'description', 'participation'],
        'projects' => ['title', 'status', 'description', 'participation'],
        'documents' => ['title', 'date', 'format', 'size', 'url'],
        'contacts' => [],
    ][$kind];
    foreach ($required as $key) {
        if (empty($data[$key])) {
            fail('Заполните обязательные поля.');
        }
    }

    if (!empty($data['date']) && !validIsoDate($data['date'])) {
        fail('Укажите существующую дату.');
    }
    if ($kind === 'news') {
        if (!preg_match('/^[a-z0-9]+(?:-[a-z0-9]+)*$/', $data['slug'])
            || !in_array($data['category'], ['Жизнь микрорайона', 'Мероприятия', 'Инициативы', 'Объявления'], true)) {
            fail('Проверьте адрес и категорию новости.');
        }
    }
    if (!empty($data['time']) && !preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', $data['time'])) {
        fail('Проверьте время.');
    }
    foreach (['source', 'image', 'url'] as $key) {
        if (!empty($data[$key]) && !isHttpUrl($data[$key])) {
            fail('Некорректная ссылка.');
        }
    }
    if (!empty($data['image']) && (empty($data['imageAlt']) || ($source['imagePermission'] ?? null) !== true)) {
        fail('Добавьте описание фотографии и подтвердите право на её размещение.');
    }
    if (!empty($data['image'])) {
        $data['imagePermission'] = true;
    }
    if (!empty($data['email']) && !validEmail($data['email'])) {
        fail('Проверьте электронную почту.');
    }
    return $data;
}

/**
 * Photos (up to 10) and videos (up to 3) of a news item or event.
 * Files uploaded through /api/admin/media are stored as /uploads/media/<name>;
 * photos saved before the upload feature remain valid as base64 data URIs.
 */
function validateMedia(array $source): array
{
    $imageInput = $source['images'] ?? [];
    $videoInput = $source['videos'] ?? [];
    if (!is_array($imageInput) || count($imageInput) > 10) {
        fail('К записи можно добавить не более 10 фотографий.');
    }
    if (!is_array($videoInput) || count($videoInput) > 3) {
        fail('К записи можно добавить не более 3 видео.');
    }
    $images = [];
    $dataBytes = 0;
    foreach ($imageInput as $image) {
        if (
            !is_array($image) || !isset($image['src'], $image['alt'])
            || !is_string($image['src']) || !is_string($image['alt'])
            || mb_strlen(trim($image['alt'])) > 180
            || !(
                preg_match('#^/uploads/media/[a-f0-9]{32}\.(?:jpg|png|webp)$#', $image['src'])
                || preg_match('#^data:image/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$#', $image['src'])
            )
        ) {
            fail('Проверьте формат фотографии и описание к ней.');
        }
        if (str_starts_with($image['src'], 'data:')) {
            $dataBytes += strlen($image['src']);
            if ($dataBytes > 850000) {
                fail('Фотографии в старом формате занимают слишком много места. Загрузите их заново.');
            }
        }
        $images[] = ['src' => $image['src'], 'alt' => trim($image['alt'])];
    }
    $videos = [];
    foreach ($videoInput as $video) {
        if (
            !is_array($video) || !isset($video['src']) || !is_string($video['src'])
            || !preg_match('#^/uploads/media/[a-f0-9]{32}\.(?:mp4|webm)$#', $video['src'])
        ) {
            fail('Проверьте видео: загрузите файл в формате MP4 или WebM.');
        }
        $title = isset($video['title']) && is_string($video['title']) ? trim($video['title']) : '';
        if (mb_strlen($title) > 180) {
            fail('Название видео не длиннее 180 символов.');
        }
        $videos[] = ['src' => $video['src'], 'title' => $title];
    }
    return [$images, $videos];
}

function validateCustomBlocks(mixed $source, int $max): array
{
    if (!is_array($source) || count($source) > $max) {
        fail('Слишком много пользовательских блоков.');
    }
    $items = [];
    $ids = [];
    foreach ($source as $item) {
        if (
            !is_array($item) || !is_string($item['id'] ?? null) || !preg_match('/^custom-[a-z0-9-]{6,40}$/', $item['id'])
            || isset($ids[$item['id']])
            || !is_string($item['title'] ?? null) || trim($item['title']) === '' || mb_strlen($item['title']) > 100
            || !is_string($item['body'] ?? null) || mb_strlen($item['body']) > 2000
        ) {
            fail('Проверьте пользовательские блоки.');
        }
        $ids[$item['id']] = true;
        $items[] = ['id' => $item['id'], 'title' => trim($item['title']), 'body' => trim($item['body'])];
    }
    return $items;
}

function validateLayout(mixed $input): array
{
    if (!is_array($input) || array_is_list($input) && $input !== []) {
        fail('Проверьте настройки страниц.');
    }
    $custom = validateCustomBlocks($input['homeCustom'] ?? [], 20);
    $customIds = array_column($custom, 'id');
    $allowed = array_merge(HOME_MODULES, $customIds);

    $order = $input['homeOrder'] ?? null;
    if (!is_array($order) || count($order) > count(HOME_MODULES) + 20 || count(array_unique($order)) !== count($order)) {
        fail('Проверьте порядок блоков главной страницы.');
    }
    foreach ($order as $id) {
        if (!idAllowed($id, $allowed)) {
            fail('Проверьте порядок блоков главной страницы.');
        }
    }
    $hidden = $input['homeHidden'] ?? null;
    if (!is_array($hidden)) {
        fail('Проверьте видимость блоков.');
    }
    foreach ($hidden as $id) {
        if (!idAllowed($id, $allowed)) {
            fail('Проверьте видимость блоков.');
        }
    }
    if (!isset($input['texts']) || !is_array($input['texts']) || array_is_list($input['texts']) && $input['texts'] !== []) {
        fail('Проверьте тексты страниц.');
    }

    $themeSource = $input['theme'] ?? [];
    if (!is_array($themeSource)) {
        fail('Проверьте оформление сайта.');
    }
    $theme = [];
    foreach (['primary', 'accent', 'ink', 'muted', 'pageBackground', 'surface', 'border', 'tint'] as $key) {
        $value = $themeSource[$key] ?? '';
        if (!is_string($value) || ($value !== '' && !preg_match('/^#[0-9a-fA-F]{6}$/', $value))) {
            fail('Цвет должен быть в формате #RRGGBB.');
        }
        if ($value !== '') {
            $theme[$key] = strtolower($value);
        }
    }
    $fonts = ['Nunito', 'Arial', 'Georgia', 'Verdana', 'Comfortaa'];
    if (isset($themeSource['font']) && !in_array($themeSource['font'], $fonts, true)) {
        fail('Выберите шрифт из списка.');
    }
    $choices = [
        'width' => ['narrow', 'standard', 'wide'],
        'scale' => ['compact', 'standard', 'large'],
        'spacing' => ['compact', 'standard', 'relaxed'],
        'backgroundMode' => ['plain', 'pattern'],
        'radius' => ['soft', 'round', 'square'],
    ];
    foreach ($choices as $key => $values) {
        if (isset($themeSource[$key]) && !in_array($themeSource[$key], $values, true)) {
            fail('Недопустимое значение настройки оформления.');
        }
    }

    $modules = [];
    $pageCustom = [];
    foreach (PAGE_MODULES as $page => $pageAllowedBase) {
        $items = validateCustomBlocks($input['pageCustom'][$page] ?? [], 10);
        $pageCustom[$page] = $items;
        $pageAllowed = array_merge($pageAllowedBase, array_column($items, 'id'));
        $state = $input['modules'][$page] ?? ['order' => $pageAllowedBase, 'hidden' => []];
        if (!is_array($state) || !is_array($state['order'] ?? null) || !is_array($state['hidden'] ?? null)
            || count($state['order']) > 30 || count(array_unique($state['order'])) !== count($state['order'])) {
            fail('Проверьте порядок и видимость блоков страницы.');
        }
        foreach (array_merge($state['order'], $state['hidden']) as $id) {
            if (!idAllowed($id, $pageAllowed)) {
                fail('Проверьте порядок и видимость блоков страницы.');
            }
        }
        $modules[$page] = ['order' => array_values($state['order']), 'hidden' => array_values(array_unique($state['hidden']))];
    }

    $texts = [];
    foreach (array_merge(EDITABLE_PAGES, ['__shared']) as $page) {
        $value = $input['texts'][$page] ?? [];
        if (!is_array($value)) {
            fail('Проверьте текст страницы.');
        }
        $title = $value['title'] ?? '';
        $lead = $value['lead'] ?? '';
        if (!is_string($title) || mb_strlen($title) > 180 || !is_string($lead) || mb_strlen($lead) > 500) {
            fail('Заголовок страницы — до 180 знаков, описание — до 500.');
        }
        $blocksSource = $value['blocks'] ?? [];
        if (!is_array($blocksSource) || count($blocksSource) > 400) {
            fail('Проверьте текстовые блоки страницы.');
        }
        $blocks = [];
        foreach ($blocksSource as $key => $text) {
            if (!preg_match('/^t-[a-z0-9-]{3,100}$/', (string) $key) || !is_string($text) || mb_strlen($text) > 4000) {
                fail('Текстовый блок слишком длинный или имеет неверный формат.');
            }
            $blocks[$key] = $text;
        }
        $texts[$page] = ['title' => trim($title), 'lead' => trim($lead), 'blocks' => $blocks];
    }
    if (strlen(json_encode($texts, JSON_UNESCAPED_UNICODE)) > 45000) {
        fail('Слишком много текста для одного сохранения. Сохраните изменения частями.');
    }

    $footerFields = ['organization', 'district', 'vkLabel', 'contactHeading', 'phone', 'email', 'addressHeading', 'addressLabel', 'address', 'legalAddressLabel', 'legalAddress', 'sectionsHeading', 'ogrn', 'inn'];
    $footerSource = $input['footer'] ?? [];
    if (!is_array($footerSource)) {
        fail('Проверьте сведения в подвале сайта.');
    }
    $footer = [];
    foreach ($footerFields as $key) {
        $value = $footerSource[$key] ?? '';
        if (!is_string($value) || mb_strlen($value) > 500) {
            fail('Текст подвала должен быть не длиннее 500 знаков.');
        }
        $footer[$key] = trim($value);
    }
    if ($footer['email'] !== '' && !validEmail($footer['email'])) {
        fail('Проверьте электронную почту в подвале.');
    }
    if ($footer['phone'] !== '' && !preg_match('/^\+?[0-9\s().-]{5,24}$/', $footer['phone'])) {
        fail('Проверьте телефон в подвале.');
    }

    $themeDefaults = ['font' => 'Nunito', 'width' => 'standard', 'scale' => 'standard', 'spacing' => 'standard', 'backgroundMode' => 'plain', 'radius' => 'soft'];
    $theme = array_merge($theme, [
        'font' => $themeSource['font'] ?? $themeDefaults['font'],
        'width' => $themeSource['width'] ?? $themeDefaults['width'],
        'scale' => $themeSource['scale'] ?? $themeDefaults['scale'],
        'spacing' => $themeSource['spacing'] ?? $themeDefaults['spacing'],
        'backgroundMode' => $themeSource['backgroundMode'] ?? $themeDefaults['backgroundMode'],
        'radius' => $themeSource['radius'] ?? $themeDefaults['radius'],
    ]);

    return [
        'homeOrder' => array_values($order),
        'homeHidden' => array_values(array_unique($hidden)),
        'homeCustom' => $custom,
        'pageCustom' => $pageCustom,
        'texts' => $texts,
        'footer' => $footer,
        'theme' => $theme,
        'modules' => $modules,
    ];
}

function idAllowed(mixed $id, array $allowed): bool
{
    return is_scalar($id) && in_array((string) $id, $allowed, true);
}
