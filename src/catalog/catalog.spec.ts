import { OpenLibraryClient } from './open-library.client';
import { CatalogService } from './catalog.service';
import { CatalogQuery } from './catalog.dto';
import { DatabaseService } from '../database/database.service';
import { ConfigService } from '@nestjs/config';

describe('Consultas del catálogo', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each([
    { q: '', category: 'history', expectedQuery: null, expectedSubject: 'history' },
    { q: 'Bolivia', category: 'history', expectedQuery: 'Bolivia', expectedSubject: 'history' },
    { q: '', category: '', expectedQuery: 'computer science', expectedSubject: null },
  ])(
    'busca "$q" en "$category" sin comodines rechazados por Open Library',
    async ({ q, category, expectedQuery, expectedSubject }) => {
      const fetchMock = jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response(JSON.stringify({ docs: [], numFound: 0 })));
      const database = { query: jest.fn() } as unknown as DatabaseService;
      const catalog = new CatalogService(
        database,
        new OpenLibraryClient(),
        new ConfigService({ LOAN_DAYS: 21 }),
      );
      const result = await catalog.search(Object.assign(new CatalogQuery(), { q, category }));
      const url = fetchMock.mock.calls[0][0] as URL;
      expect(url.searchParams.get('q')).toBe(expectedQuery);
      expect(url.searchParams.get('subject')).toBe(expectedSubject);
      expect(result.books).toEqual([]);
      expect(database.query).not.toHaveBeenCalled();
    },
  );

  it('ordena por popularidad en Open Library antes de paginar', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ docs: [], numFound: 500000 })));
    const catalog = new CatalogService(
      { query: jest.fn() } as unknown as DatabaseService,
      new OpenLibraryClient(),
      new ConfigService(),
    );
    const result = await catalog.search(
      Object.assign(new CatalogQuery(), { sort: 'popular', page: 2 }),
    );
    const url = fetchMock.mock.calls[0][0] as URL;
    expect(url.searchParams.get('sort')).toBe('readinglog');
    expect(url.searchParams.get('page')).toBe('2');
    expect(result.total).toBe(120000);
    expect(result.matchedTotal).toBe(500000);
  });

  it('filtra por autor en el conjunto de resultados sin añadir la selección inicial de informática', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ docs: [], numFound: 0 })));
    const db = { query: jest.fn() } as unknown as DatabaseService;
    const catalog = new CatalogService(db, new OpenLibraryClient(), new ConfigService());
    const result = await catalog.search(
      Object.assign(new CatalogQuery(), { author: 'Isaac Asimov', page: 2 }),
    );
    expect(result.books).toEqual([]);
    const url = fetchMock.mock.calls[0][0] as URL;
    expect(url.searchParams.get('author')).toBe('Isaac Asimov');
    expect(url.searchParams.has('q')).toBe(false);
    expect(url.searchParams.get('page')).toBe('2');
    expect(url.searchParams.get('limit')).toBe('12');
    expect(url.searchParams.has('sort')).toBe(false);
  });

  it('ordena la selección completa por primer autor antes de paginar y mantiene la disponibilidad', async () => {
    const docs = Array.from({ length: 25 }, (_, index) => ({
      key: `/works/OL${index + 1}W`,
      title: `Libro ${String(index).padStart(2, '0')}`,
      author_name: index === 24 ? [] : [index % 2 ? 'Zoe' : 'Álvaro', 'Coautor'],
    })).reverse();
    const upstream = { request: jest.fn().mockResolvedValue({ docs, numFound: 25 }) };
    const db = {
      query: jest.fn().mockResolvedValue({ rows: [{ book_id: 'OL1W', availability: 'reserved' }] }),
    };
    const service = new CatalogService(
      db as unknown as DatabaseService,
      upstream as unknown as OpenLibraryClient,
      new ConfigService(),
    );
    const first = await service.search(
      Object.assign(new CatalogQuery(), {
        q: 'libros',
        author: 'Coautor',
        sort: 'author',
        page: 1,
      }),
    );
    const second = await service.search(
      Object.assign(new CatalogQuery(), {
        q: 'libros',
        author: 'Coautor',
        sort: 'author',
        page: 2,
      }),
    );
    const last = await service.search(
      Object.assign(new CatalogQuery(), {
        q: 'libros',
        author: 'Coautor',
        sort: 'author',
        page: 3,
      }),
    );
    const combined = [...first.books, ...second.books, ...last.books];
    expect(combined.slice(0, 12).every((book) => book.authors[0] === 'Álvaro')).toBe(true);
    expect(combined.slice(12, 24).every((book) => book.authors[0] === 'Zoe')).toBe(true);
    expect(combined.at(-1)?.authors).toEqual([]);
    expect(new Set(combined.map((book) => book.id)).size).toBe(25);
    expect(first.books[0]).toMatchObject({
      id: 'OL1W',
      available: false,
      availability: 'reserved',
    });
    expect(first).toMatchObject({
      total: 25,
      matchedTotal: 25,
      authorSortLimit: 200,
      pageSize: 12,
    });
    const urls = upstream.request.mock.calls.map(([url]) => url as URL);
    expect(new Set(urls.map((url) => url.href)).size).toBe(1);
    expect(urls[0].searchParams.get('limit')).toBe('200');
    expect(urls[0].searchParams.get('page')).toBe('1');
    expect(urls[0].searchParams.get('q')).toBe('libros');
    expect(urls[0].searchParams.get('author')).toBe('Coautor');
    expect(urls[0].searchParams.has('sort')).toBe(false);
  });

  it('declara el límite de autor y devuelve la última página parcial sin cargar otra selección', async () => {
    const docs = Array.from({ length: 200 }, (_, index) => ({
      key: `/works/OL${index + 1}W`,
      title: `Libro ${index}`,
      author_name: ['Autora'],
    }));
    const upstream = { request: jest.fn().mockResolvedValue({ docs, numFound: 50000 }) };
    const service = new CatalogService(
      { query: jest.fn().mockResolvedValue({ rows: [] }) } as unknown as DatabaseService,
      upstream as unknown as OpenLibraryClient,
      new ConfigService(),
    );
    const result = await service.search(
      Object.assign(new CatalogQuery(), { sort: 'author', page: 17 }),
    );
    expect(result).toMatchObject({
      total: 200,
      matchedTotal: 50000,
      authorSortLimit: 200,
      page: 17,
    });
    expect(result.books).toHaveLength(8);
    const outside = await service.search(
      Object.assign(new CatalogQuery(), { sort: 'author', page: 18 }),
    );
    expect(outside.books).toEqual([]);
  });

  it('desempata autores equivalentes por título e identificador y elimina obras repetidas', async () => {
    const docs = [
      { key: '/works/OL3W', title: 'Zeta', author_name: ['Álvaro'] },
      { key: '/works/OL2W', title: 'Alfa', author_name: ['alvaro'] },
      { key: '/works/OL1W', title: 'Alfa', author_name: ['Álvaro'] },
      { key: '/works/OL1W', title: 'Alfa', author_name: ['Álvaro'] },
    ];
    const upstream = { request: jest.fn().mockResolvedValue({ docs, numFound: 4 }) };
    const service = new CatalogService(
      { query: jest.fn().mockResolvedValue({ rows: [] }) } as unknown as DatabaseService,
      upstream as unknown as OpenLibraryClient,
      new ConfigService(),
    );
    const result = await service.search(Object.assign(new CatalogQuery(), { sort: 'author' }));
    expect(result.books.map((book) => book.id)).toEqual(['OL1W', 'OL2W', 'OL3W']);
    expect(result.total).toBe(3);
  });
});
