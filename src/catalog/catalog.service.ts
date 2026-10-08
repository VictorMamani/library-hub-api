import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CatalogQuery } from './catalog.dto';
import type { Book, CatalogPage } from './book.types';
import { mapDocument } from './catalog.mapper';
import type { Document, SearchResponse } from './catalog.mapper';
import { OpenLibraryClient } from './open-library.client';

@Injectable()
export class CatalogService {
  private readonly pageSize = 12;
  constructor(
    private readonly db: DatabaseService,
    private readonly client: OpenLibraryClient,
  ) {}
  async search(query: CatalogQuery): Promise<CatalogPage> {
    const url = new URL('https://openlibrary.org/search.json');
    if (query.q) url.searchParams.set('q', query.q);
    else if (!query.category) url.searchParams.set('q', 'computer science');
    if (query.category) url.searchParams.set('subject', query.category);
    if (query.sort !== 'relevance') url.searchParams.set('sort', query.sort);
    url.searchParams.set('page', String(query.page));
    url.searchParams.set('limit', String(this.pageSize));
    url.searchParams.set('fields', 'key,title,author_name,cover_i,first_publish_year,subject');
    const response = await this.client.request<SearchResponse>(url);
    if (!Array.isArray(response.docs))
      throw new BadGatewayException('La respuesta del catálogo no es válida.');
    const books = response.docs
      .map((doc) => mapDocument(doc))
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
    const active = await this.db.query(
      'SELECT id FROM loans WHERE book_id = $1 AND returned_at IS NULL',
      [id],
    );
    book.available = !active.rowCount;
    return book;
  }
}
