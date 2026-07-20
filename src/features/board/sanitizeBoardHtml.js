import sanitizeHtml from 'sanitize-html';

const options = {
    allowedTags: [
        'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'blockquote',
        'pre', 'code', 'ol', 'ul', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'span', 'div', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
        'img', 'a', 'sub', 'sup', 'hr'
    ],
    allowedAttributes: {
        '*': ['class', 'style', 'title'],
        a: ['href', 'title', 'rel'],
        img: ['src', 'alt', 'title', 'width', 'height'],
        table: ['border', 'cellpadding', 'cellspacing', 'width'],
        th: ['colspan', 'rowspan', 'scope', 'width', 'height'],
        td: ['colspan', 'rowspan', 'width', 'height'],
        ol: ['start', 'type'],
        li: ['value']
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesByTag: { img: ['http', 'https', 'data'] },
    allowedStyles: {
        '*': {
            color: [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d\s,.%]+\)$/i, /^[a-z]+$/i],
            'background-color': [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d\s,.%]+\)$/i, /^[a-z]+$/i],
            'text-align': [/^(left|right|center|justify)$/],
            'font-weight': [/^(normal|bold|[1-9]00)$/],
            'font-style': [/^(normal|italic)$/],
            'text-decoration': [/^(none|underline|line-through)$/],
            width: [/^\d+(\.\d+)?(px|%|em|rem)?$/],
            height: [/^\d+(\.\d+)?(px|%|em|rem)?$/],
            'max-width': [/^\d+(\.\d+)?(px|%|em|rem)?$/],
            border: [/^[\w\s#().,%+-]+$/],
            'border-width': [/^\d+(\.\d+)?px$/],
            'border-style': [/^(none|solid|dashed|dotted|double)$/],
            'border-color': [/^#[0-9a-f]{3,8}$/i, /^[a-z]+$/i],
            'border-collapse': [/^(collapse|separate)$/],
            padding: [/^[\d\s.%a-z-]+$/i],
            margin: [/^[\d\s.%a-z-]+$/i],
            'vertical-align': [/^(top|middle|bottom|baseline)$/]
        }
    },
    disallowedTagsMode: 'discard',
    enforceHtmlBoundary: true,
    transformTags: {
        a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }, true)
    }
};

export function sanitizeBoardHtml(value) {
    return sanitizeHtml(String(value || ''), options);
}
