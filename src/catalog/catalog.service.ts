import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';
import { CatalogQuery } from './catalog.dto';
import type { Book, CatalogPage } from './book.types';
import { mapDocument } from './catalog.mapper';
import type { Document, SearchResponse } from './catalog.mapper';
import { OpenLibraryClient } from './open-library.client';

@Injectable()
export class CatalogService {
  private readonly pageSize = 12;
  private readonly authorSortLimit = 200;
  private readonly authorCollator = new Intl.Collator('es', { sensitivity: 'base' });
  constructor(
    private readonly db: DatabaseService,
    private readonly client: OpenLibraryClient,
    private readonly config: ConfigService,
  ) {}
  async search(query: CatalogQuery): Promise<CatalogPage> {
    const url = new URL('https://openlibrary.org/search.json');
    if (query.q) url.searchParams.set('q', query.q);
    else if (!query.category && !query.author) url.searchParams.set('q', 'computer science');
    if (query.category) url.searchParams.set('subject', query.category);
    if (query.author) url.searchParams.set('author', query.author);
    if (query.sort === 'popular') url.searchParams.set('sort', 'readinglog');
    else if (query.sort !== 'relevance' && query.sort !== 'author')
      url.searchParams.set('sort', query.sort);
    const byAuthor = query.sort === 'author';
    url.searchParams.set('page', String(byAuthor ? 1 : query.page));
    url.searchParams.set('limit', String(byAuthor ? this.authorSortLimit : this.pageSize));
    url.searchParams.set(
      'fields',
      'key,title,author_name,cover_i,first_publish_year,subject,readinglog_count',
    );
    const response = await this.client.request<SearchResponse>(url);
    if (!Array.isArray(response.docs))
      throw new BadGatewayException('La respuesta del catálogo no es válida.');
    const mapped = response.docs
      .map((doc) => mapDocument(doc))
      .filter((book): book is Book => Boolean(book));
    let selection = mapped;
    if (byAuthor) {
      selection = [...new Map(mapped.map((book) => [book.id, book])).values()]
        .slice(0, this.authorSortLimit)
        .sort((left, right) => {
          const a = left.authors[0]?.trim() ?? '';
          const b = right.authors[0]?.trim() ?? '';
          if (!a && b) return 1;
          if (a && !b) return -1;
          return (
            this.authorCollator.compare(a, b) ||
            this.authorCollator.compare(left.title, right.title) ||
            left.id.localeCompare(right.id)
          );
        });
    }
    const matchedTotal = response.numFound ?? response.num_found ?? mapped.length;
    const total = byAuthor ? selection.length : Math.min(matchedTotal, 10000 * this.pageSize);
    const books = byAuthor
      ? selection.slice((query.page - 1) * this.pageSize, query.page * this.pageSize)
      : selection;
    if (books.length) {
      const active = await this.db.query<{
        book_id: string;
        availability: 'borrowed' | 'reserved';
      }>(
        `SELECT book_id, 'borrowed' AS availability FROM loans
         WHERE returned_at IS NULL AND book_id = ANY($1::text[])
         UNION ALL SELECT book_id, 'reserved' AS availability FROM reservations
         WHERE status = 'waiting' AND book_id = ANY($1::text[])`,
        [books.map((book) => book.id)],
      );
      const unavailable = new Map(active.rows.map((row) => [row.book_id, row.availability]));
      active.rows
        .filter((row) => row.availability === 'borrowed')
        .forEach((row) => unavailable.set(row.book_id, 'borrowed'));
      books.forEach((book) => {
        book.availability = unavailable.get(book.id) ?? 'available';
        book.available = !unavailable.has(book.id);
      });
    }
    return {
      books,
      total,
      page: query.page,
      pageSize: this.pageSize,
      matchedTotal,
      ...(byAuthor ? { authorSortLimit: this.authorSortLimit } : {}),
    };
  }

  async detail(id: string): Promise<Book> {
    if (!/^OL\d+W$/.test(id)) throw new BadRequestException('Identificador de libro no válido.');
    const url = new URL('https://openlibrary.org/search.json');
    url.searchParams.set('q', `key:/works/${id}`);
    url.searchParams.set('limit', '1');
    url.searchParams.set('fields', 'key,title,author_name,cover_i,first_publish_year,subject');
    const response = await this.client.request<SearchResponse>(url);
    const book = response.docs?.[0] ? mapDocument(response.docs[0]) : null;
    if (!book || book.id !== id) throw new NotFoundException('No se encontró el libro.');
    const work = await this.client.request<Document>(
      new URL(`https://openlibrary.org/works/${id}.json`),
    );
    const description = work.description;
    book.description =
      typeof description === 'string'
        ? description
        : typeof (description as { value?: unknown })?.value === 'string'
          ? (description as { value: string }).value
          : '';
    const active = await this.db.query<{ availability: 'borrowed' | 'reserved' }>(
      `SELECT 'borrowed' AS availability FROM loans WHERE book_id = $1 AND returned_at IS NULL
       UNION ALL SELECT 'reserved' AS availability FROM reservations WHERE book_id = $1 AND status = 'waiting'`,
      [id],
    );
    book.available = !active.rowCount;
    book.availability = active.rows.some((row) => row.availability === 'borrowed')
      ? 'borrowed'
      : active.rowCount
        ? 'reserved'
        : 'available';
    book.loanDays = this.config.getOrThrow<number>('LOAN_DAYS');
    return book;
  }
}
