import { CatalogService } from './catalog.service';
import { CatalogQuery } from './catalog.dto';
import { DatabaseService } from '../database/database.service';

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
      const catalog = new CatalogService(database);
      const result = await catalog.search(Object.assign(new CatalogQuery(), { q, category }));
      const url = fetchMock.mock.calls[0][0] as URL;
      expect(url.searchParams.get('q')).toBe(expectedQuery);
      expect(url.searchParams.get('subject')).toBe(expectedSubject);
      expect(result.books).toEqual([]);
      expect(database.query).not.toHaveBeenCalled();
    },
  );
});
