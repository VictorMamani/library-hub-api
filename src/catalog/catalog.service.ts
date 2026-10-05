import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CatalogQuery } from './catalog.dto';
import type { Book, CatalogPage } from './book.types';

type Document = Record<string, unknown>;
interface SearchResponse {
  docs?: Document[];
  numFound?: number;
  num_found?: number;
}
const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === 'string'))]
    : [];

@Injectable()
export class CatalogService {
  private readonly cache = new Map<string, { expires: number; value: unknown }>();
  private readonly pending = new Map<string, Promise<unknown>>();
  private queue: Promise<void> = Promise.resolve();
  private nextRequest = 0;
  private readonly pageSize = 12;

  constructor(private readonly db: DatabaseService) {}

  private request<T>(url: URL): Promise<T> {
    const key = url.href;
    const cached = this.cache.get(key);
    if (cached && cached.expires > Date.now()) return Promise.resolve(cached.value as T);
    const pending = this.pending.get(key);
    if (pending) return pending as Promise<T>;

    const gate = this.queue.then(async () => {
      const delay = Math.max(0, this.nextRequest - Date.now());
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      this.nextRequest = Date.now() + 1100;
    });
    this.queue = gate.catch(() => undefined);
    const result = gate
      .then(async () => {
        try {
          const response = await fetch(url, {
            signal: AbortSignal.timeout(15000),
            headers: {
              'User-Agent': 'LibraryHub/0.1 (academic catalog application)',
              Accept: 'application/json',
            },
          });
          if (response.status === 404)
            throw new NotFoundException('El libro no está disponible en el catálogo.');
          if (!response.ok) throw new Error(`Open Library ${response.status}`);
          const value: unknown = await response.json();
          if (this.cache.size >= 100) this.cache.delete(this.cache.keys().next().value!);
          this.cache.set(key, { expires: Date.now() + 60000, value });
          return value;
        } catch (error) {
          if (error instanceof NotFoundException) throw error;
          throw new BadGatewayException('No se pudo consultar Open Library. Intenta nuevamente.');
        }
      })
      .finally(() => this.pending.delete(key));
    this.pending.set(key, result);
    return result as Promise<T>;
  }

  private mapDocument(doc: Document): Book | null {
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
    };
  }

  async search(query: CatalogQuery): Promise<CatalogPage> {
    const url = new URL('https://openlibrary.org/search.json');
    if (query.q) url.searchParams.set('q', query.q);
    else if (!query.category) url.searchParams.set('q', 'computer science');
    if (query.category) url.searchParams.set('subject', query.category);
    if (query.sort !== 'relevance') url.searchParams.set('sort', query.sort);
    url.searchParams.set('page', String(query.page));
    url.searchParams.set('limit', String(this.pageSize));
    url.searchParams.set('fields', 'key,title,author_name,cover_i,first_publish_year,subject');
    const response = await this.request<SearchResponse>(url);
    if (!Array.isArray(response.docs))
      throw new BadGatewayException('La respuesta del catálogo no es válida.');
    const books = response.docs
      .map((doc) => this.mapDocument(doc))
      .filter((book): book is Book => Boolean(book));
    if (books.length) {
      const active = await this.db.query<{ book_id: string }>(
        'SELECT book_id FROM loans WHERE returned_at IS NULL AND book_id = ANY($1::text[])',
        [books.map((book) => book.id)],
      );
      const unavailable = new Set(active.rows.map((row) => row.book_id));
      books.forEach((book) => {
        book.available = !unavailable.has(book.id);
      });
    }
    return {
      books,
      total: response.numFound ?? response.num_found ?? books.length,
      page: query.page,
      pageSize: this.pageSize,
    };
  }

  async detail(id: string): Promise<Book> {
    if (!/^OL\d+W$/.test(id)) throw new BadRequestException('Identificador de libro no válido.');
    const url = new URL('https://openlibrary.org/search.json');
    url.searchParams.set('q', `key:/works/${id}`);
    url.searchParams.set('limit', '1');
    url.searchParams.set('fields', 'key,title,author_name,cover_i,first_publish_year,subject');
    const response = await this.request<SearchResponse>(url);
    const book = response.docs?.[0] ? this.mapDocument(response.docs[0]) : null;
    if (!book || book.id !== id) throw new NotFoundException('No se encontró el libro.');
    const work = await this.request<Document>(new URL(`https://openlibrary.org/works/${id}.json`));
    const description = work.description;
    book.description =
      typeof description === 'string'
        ? description
        : typeof (description as { value?: unknown })?.value === 'string'
          ? (description as { value: string }).value
          : '';
    const active = await this.db.query(
      'SELECT id FROM loans WHERE book_id = $1 AND returned_at IS NULL',
      [id],
    );
    book.available = !active.rowCount;
    return book;
  }
}
