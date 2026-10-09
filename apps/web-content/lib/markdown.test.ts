import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdown';
import { plural, priceRu } from './format';

describe('renderMarkdown', () => {
  it('renders headings, lists, emphasis and links', () => {
    const html = renderMarkdown('## Шаги\n1. Первый **важный**\n2. Второй\n\nСм. [сайт](https://example.com).');
    expect(html).toBe(
      '<h2>Шаги</h2>\n<ol><li>Первый <strong>важный</strong></li><li>Второй</li></ol>\n<p>См. <a href="https://example.com" rel="noopener noreferrer" target="_blank">сайт</a>.</p>',
    );
  });

  it('escapes HTML and drops non-http links', () => {
    const html = renderMarkdown('<script>alert(1)</script> [x](javascript:alert(1)) <img src=x onerror=alert(1)>');
    expect(html).not.toMatch(/<script|<img|href="javascript/);
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('Russian formatting', () => {
  it('picks the right plural form', () => {
    expect([1, 2, 5, 11, 21, 22, 25].map((n) => plural(n, ['отзыв', 'отзыва', 'отзывов']))).toEqual([
      'отзыв', 'отзыва', 'отзывов', 'отзывов', 'отзыв', 'отзыва', 'отзывов',
    ]);
  });

  it('formats an indicative price', () => {
    expect(priceRu('2450', 'USD', 'PER_PERSON')?.replace(/\s/g, ' ')).toBe('от 2 450 $ с человека');
    expect(priceRu(null, null, 'PER_GROUP')).toBeNull();
  });
});
