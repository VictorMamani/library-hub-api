import type { Book } from './book.types';

export type Document = Record<string, unknown>;
export interface SearchResponse {
  docs?: Document[];
  numFound?: number;
  num_found?: number;
}
const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === 'string'))]
    : [];

export function mapDocument(doc: Document): Book | null {
  if (typeof doc.key !== 'string' || typeof doc.title !== 'string') return null;
  const id = doc.key.replace('/works/', '');
  if (!/^OL\d+W$/.test(id)) return null;
  return {
    id,
    title: doc.title,
    authors: strings(doc.author_name),
    coverId: typeof doc.cover_i === 'number' ? doc.cover_i : null,
    publicationYear: typeof doc.first_publish_year === 'number' ? doc.first_publish_year : null,
    subjects: strings(doc.subject).slice(0, 8),
    description: '',
    available: true,
    readingCount:
      typeof doc.readinglog_count === 'number' && doc.readinglog_count >= 0
        ? doc.readinglog_count
        : 0,
  };
}
