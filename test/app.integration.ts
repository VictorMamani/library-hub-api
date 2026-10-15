import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import request from 'supertest';
import { DatabaseService } from '../src/database/database.service';
import { CatalogService } from '../src/catalog/catalog.service';
import { configureApplication } from '../src/setup';

const origin = 'http://localhost:5180';
const password = 'Contraseña de integración 2026';
const book = {
  id: 'OL123456W',
  title: 'Libro de prueba',
  authors: ['Autora de prueba'],
  coverId: null,
  publicationYear: 2020,
  subjects: [],
  description: 'Datos de integración',
  available: true,
};
const headers = { Origin: origin, 'X-Library-Client': 'web' };

describe('Autenticación y préstamos con PostgreSQL', () => {
  let app: INestApplication;
  let db: DatabaseService;

  beforeAll(async () => {
    const url =
      process.env.TEST_DATABASE_URL ??
      'postgresql://library_hub:library_hub_dev@localhost:54329/library_hub_test';
    if (new URL(url).pathname !== '/library_hub_test')
      throw new Error('Las pruebas solo pueden usar la base library_hub_test.');
    process.env.DATABASE_URL = url;
    process.env.JWT_SECRET = 'integration-tests-only-secret-at-least-32-characters';
    process.env.APP_ORIGIN = origin;
    process.env.NODE_ENV = 'test';
    const { AppModule } = await import('../src/app.module');
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CatalogService)
      .useValue({
        detail: jest.fn().mockResolvedValue(book),
        search: jest.fn().mockResolvedValue({
          books: [book],
          total: 1,
          matchedTotal: 1,
          page: 1,
          pageSize: 12,
          authorSortLimit: 200,
        }),
      })
      .compile();
    app = module.createNestApplication();
    configureApplication(app);
    await app.init();
    db = app.get(DatabaseService);
  });

  beforeEach(async () => {
    app.get<ThrottlerStorageService>(ThrottlerStorage).onApplicationShutdown();
    await db.query(
      'TRUNCATE reading_states, reservations, profile_photos, loans, sessions, books, users',
    );
  });
  afterAll(async () => {
    if (app) await app.close();
  });

  async function register(email: string) {
    return request(app.getHttpServer())
      .post('/api/auth/register')
      .set(headers)
      .send({ name: 'Estudiante', email, password })
      .expect(201);
  }

  function cookie(response: request.Response) {
    const values = response.headers['set-cookie'] as unknown as string[];
    return values[0].split(';')[0];
  }

  it('acepta orden por autor en el catálogo público y rechaza órdenes desconocidos', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/books?sort=author&author=Autora&page=1')
      .expect(200);
    expect(response.body.authorSortLimit).toBe(200);
    expect(app.get(CatalogService).search).toHaveBeenCalledWith(
      expect.objectContaining({ sort: 'author', author: 'Autora', page: 1 }),
    );
    await request(app.getHttpServer()).get('/api/books?sort=invalid').expect(400);
  });

  it('valida el origen, los datos y las credenciales', async () => {
    await request(app.getHttpServer()).post('/api/auth/refresh').set(headers).expect(204);
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ name: 'Estudiante', email: 'user@example.com', password })
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .set(headers)
      .send({ name: 'Estudiante', email: 'bad-email', password: 'short' })
      .expect(400);
    const registration = await register('user@example.com');
    expect(registration.body.refreshToken).toBeUndefined();
    expect(registration.headers['set-cookie'][0]).toContain('HttpOnly');
    expect(registration.headers['set-cookie'][0]).toContain('SameSite=Strict');
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .set(headers)
      .send({ email: 'user@example.com', password: 'Contraseña equivocada y larga' })
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .set(headers)
      .send({ email: 'user@example.com', password })
      .expect(200);
  });

  it('rota el refresh token y revoca el acceso al cerrar sesión', async () => {
    const registration = await register('session@example.com');
    const firstCookie = cookie(registration);
    const refreshed = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set(headers)
      .set('Cookie', firstCookie)
      .expect(200);
    expect(cookie(refreshed)).not.toBe(firstCookie);
    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set(headers)
      .set('Cookie', firstCookie)
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .auth(refreshed.body.accessToken, { type: 'bearer' })
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set(headers)
      .set('Cookie', cookie(refreshed))
      .expect(204);
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .auth(refreshed.body.accessToken, { type: 'bearer' })
      .expect(401);
  });

  it('persiste el préstamo, protege su dueño y conserva el historial al devolver', async () => {
    const owner = await register('owner@example.com');
    const other = await register('other@example.com');
    const loan = await request(app.getHttpServer())
      .post('/api/loans')
      .auth(owner.body.accessToken, { type: 'bearer' })
      .send({ bookId: book.id })
      .expect(201);
    const list = await request(app.getHttpServer())
      .get('/api/loans')
      .auth(owner.body.accessToken, { type: 'bearer' })
      .expect(200);
    expect(list.body).toHaveLength(1);
    expect(new Date(list.body[0].dueAt).getTime()).toBeGreaterThan(
      new Date(list.body[0].borrowedAt).getTime(),
    );
    const otherList = await request(app.getHttpServer())
      .get('/api/loans')
      .auth(other.body.accessToken, { type: 'bearer' })
      .expect(200);
    expect(otherList.body).toEqual([]);
    await request(app.getHttpServer())
      .post(`/api/loans/${loan.body.id}/return`)
      .auth(other.body.accessToken, { type: 'bearer' })
      .expect(404);
    await request(app.getHttpServer())
      .post(`/api/loans/${loan.body.id}/return`)
      .auth(owner.body.accessToken, { type: 'bearer' })
      .expect(201);
    const history = await request(app.getHttpServer())
      .get('/api/loans')
      .auth(owner.body.accessToken, { type: 'bearer' })
      .expect(200);
    expect(history.body[0].returnedAt).not.toBeNull();
    await request(app.getHttpServer())
      .post(`/api/loans/${loan.body.id}/return`)
      .auth(owner.body.accessToken, { type: 'bearer' })
      .expect(404);
  });

  it('permite solo un préstamo cuando dos usuarios compiten por el ejemplar', async () => {
    const first = await register('first@example.com');
    const second = await register('second@example.com');
    const results = await Promise.all(
      [first, second].map((user) =>
        request(app.getHttpServer())
          .post('/api/loans')
          .auth(user.body.accessToken, { type: 'bearer' })
          .send({ bookId: book.id }),
      ),
    );
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    const persisted = await db.query('SELECT id FROM loans WHERE returned_at IS NULL');
    expect(persisted.rowCount).toBe(1);
  });

  it('rechaza préstamos sin sesión y campos de identidad enviados por el cliente', async () => {
    await request(app.getHttpServer()).post('/api/loans').send({ bookId: book.id }).expect(401);
    const user = await register('validation@example.com');
    await request(app.getHttpServer())
      .post('/api/loans')
      .auth(user.body.accessToken, { type: 'bearer' })
      .send({ bookId: book.id, userId: 'another-user' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/loans')
      .auth(user.body.accessToken, { type: 'bearer' })
      .send({ bookId: '../../unexpected' })
      .expect(400);
  });

  it('guarda, reemplaza y elimina la foto privada de la cuenta', async () => {
    const owner = await register('photo-owner@example.com');
    const other = await register('photo-other@example.com');
    const photo = `data:image/jpeg;base64,${readFileSync(join(process.cwd(), 'test/fixtures/profile.jpg')).toString('base64')}`;
    const first = await request(app.getHttpServer())
      .get('/api/profile/photo')
      .auth(owner.body.accessToken, { type: 'bearer' })
      .expect(200);
    expect(first.body).toEqual({ photo: null });
    await request(app.getHttpServer())
      .post('/api/profile/photo')
      .set(headers)
      .auth(owner.body.accessToken, { type: 'bearer' })
      .send({ photo })
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/profile/photo')
      .set(headers)
      .auth(owner.body.accessToken, { type: 'bearer' })
      .send({ photo })
      .expect(200);
    const persisted = await request(app.getHttpServer())
      .get('/api/profile/photo')
      .auth(owner.body.accessToken, { type: 'bearer' })
      .expect(200);
    expect(persisted.body.photo).toBe(photo);
    expect(persisted.headers['cache-control']).toBe('no-store');
    const privatePhoto = await request(app.getHttpServer())
      .get('/api/profile/photo')
      .auth(other.body.accessToken, { type: 'bearer' })
      .expect(200);
    expect(privatePhoto.body).toEqual({ photo: null });
    const rows = await db.query('SELECT user_id FROM profile_photos');
    expect(rows.rowCount).toBe(1);
    await request(app.getHttpServer())
      .post('/api/profile/photo/remove')
      .set(headers)
      .auth(owner.body.accessToken, { type: 'bearer' })
      .expect(200);
    const removed = await request(app.getHttpServer())
      .get('/api/profile/photo')
      .auth(owner.body.accessToken, { type: 'bearer' })
      .expect(200);
    expect(removed.body).toEqual({ photo: null });
  });

  it('rechaza fotos sin sesión, sin origen válido, con identidad ajena o datos inválidos', async () => {
    await request(app.getHttpServer()).get('/api/profile/photo').expect(401);
    await request(app.getHttpServer())
      .post('/api/profile/photo')
      .set(headers)
      .send({ photo: 'bad' })
      .expect(401);
    const owner = await register('photo-validation@example.com');
    const token = owner.body.accessToken;
    await request(app.getHttpServer())
      .post('/api/profile/photo')
      .auth(token, { type: 'bearer' })
      .send({ photo: 'bad' })
      .expect(403);
    for (const photo of [
      'data:image/svg+xml;base64,PHN2Zz4=',
      'data:image/jpeg;base64,aGVsbG8=',
      `data:image/jpeg;base64,${Buffer.alloc(66000).toString('base64')}`,
    ]) {
      await request(app.getHttpServer())
        .post('/api/profile/photo')
        .set(headers)
        .auth(token, { type: 'bearer' })
        .send({ photo })
        .expect(400);
    }
    await request(app.getHttpServer())
      .post('/api/profile/photo')
      .set(headers)
      .auth(token, { type: 'bearer' })
      .send({ photo: 'bad', userId: 'someone-else' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/profile/photo/remove')
      .auth(token, { type: 'bearer' })
      .expect(403);
    expect((await db.query('SELECT user_id FROM profile_photos')).rowCount).toBe(0);
  });

  it('mantiene una cola privada, evita duplicados y respeta el turno al devolver', async () => {
    const owner = await register('reserve-owner@example.com');
    const first = await register('reserve-first@example.com');
    const second = await register('reserve-second@example.com');
    const borrow = (user: request.Response) =>
      request(app.getHttpServer())
        .post('/api/loans')
        .auth(user.body.accessToken, { type: 'bearer' })
        .send({ bookId: book.id });
    const reserve = (user: request.Response) =>
      request(app.getHttpServer())
        .post('/api/reservations')
        .auth(user.body.accessToken, { type: 'bearer' })
        .send({ bookId: book.id });
    const list = (user: request.Response) =>
      request(app.getHttpServer())
        .get('/api/reservations')
        .auth(user.body.accessToken, { type: 'bearer' })
        .expect(200);
    const loan = await borrow(owner).expect(201);
    await reserve(owner).expect(409);
    const concurrent = await Promise.all([reserve(first), reserve(first)]);
    expect(concurrent.map((result) => result.status).sort()).toEqual([201, 409]);
    await reserve(second).expect(201);
    const firstList = await list(first);
    expect(firstList.body.items).toHaveLength(1);
    expect(firstList.body.items[0]).toMatchObject({ position: 1, ready: false });
    expect((await list(second)).body.items[0]).toMatchObject({ position: 2, ready: false });
    expect((await list(owner)).body.items).toEqual([]);
    const firstId = firstList.body.items[0].id;
    await request(app.getHttpServer())
      .post(`/api/reservations/${firstId}/cancel`)
      .auth(second.body.accessToken, { type: 'bearer' })
      .expect(404);
    await request(app.getHttpServer())
      .post(`/api/loans/${loan.body.id}/return`)
      .auth(owner.body.accessToken, { type: 'bearer' })
      .expect(201);
    expect((await list(first)).body.items[0].ready).toBe(true);
    await borrow(second).expect(409);
    await borrow(owner).expect(409);
    const claimed = await borrow(first).expect(201);
    expect((await list(first)).body.items).toEqual([]);
    expect((await list(second)).body.items[0]).toMatchObject({ position: 1, ready: false });
    await request(app.getHttpServer())
      .post(`/api/loans/${claimed.body.id}/return`)
      .auth(first.body.accessToken, { type: 'bearer' })
      .expect(201);
    const secondId = (await list(second)).body.items[0].id;
    await request(app.getHttpServer())
      .post(`/api/reservations/${secondId}/cancel`)
      .auth(second.body.accessToken, { type: 'bearer' })
      .expect(201);
    await borrow(owner).expect(201);
    const statuses = await db.query<{ status: string }>(
      'SELECT status FROM reservations ORDER BY created_at',
    );
    expect(statuses.rows.map((row) => row.status)).toEqual(['fulfilled', 'cancelled']);
  });

  it('rechaza reservas sin sesión, identidad ajena y reserva de un ejemplar libre', async () => {
    await request(app.getHttpServer())
      .post('/api/reservations')
      .send({ bookId: book.id })
      .expect(401);
    const user = await register('reserve-validation@example.com');
    await request(app.getHttpServer())
      .post('/api/reservations')
      .auth(user.body.accessToken, { type: 'bearer' })
      .send({ bookId: book.id, userId: 'another' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/reservations')
      .auth(user.body.accessToken, { type: 'bearer' })
      .send({ bookId: '../bad' })
      .expect(400);
    await request(app.getHttpServer())
      .get('/api/reservations?page=0')
      .auth(user.body.accessToken, { type: 'bearer' })
      .expect(400);
    const loan = await request(app.getHttpServer())
      .post('/api/loans')
      .auth(user.body.accessToken, { type: 'bearer' })
      .send({ bookId: book.id })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/loans/${loan.body.id}/return`)
      .auth(user.body.accessToken, { type: 'bearer' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/reservations')
      .auth(user.body.accessToken, { type: 'bearer' })
      .send({ bookId: book.id })
      .expect(409);
  });

  it('persiste lectura por usuario, valida estados y permite quitar el seguimiento', async () => {
    const first = await register('reading-first@example.com');
    const second = await register('reading-second@example.com');
    const path = `/api/reading/${book.id}`;
    await request(app.getHttpServer()).get(path).expect(401);
    for (const status of ['wishlist', 'reading', 'completed']) {
      await request(app.getHttpServer())
        .post(path)
        .auth(first.body.accessToken, { type: 'bearer' })
        .send({ status })
        .expect(201);
      const saved = await request(app.getHttpServer())
        .get(path)
        .auth(first.body.accessToken, { type: 'bearer' })
        .expect(200);
      expect(saved.body.status).toBe(status);
      expect(saved.headers['cache-control']).toBe('no-store');
    }
    const other = await request(app.getHttpServer())
      .get(path)
      .auth(second.body.accessToken, { type: 'bearer' })
      .expect(200);
    expect(other.body.status).toBe('none');
    const readingList = await request(app.getHttpServer())
      .get('/api/reading?status=completed')
      .auth(first.body.accessToken, { type: 'bearer' })
      .expect(200);
    expect(readingList.body.items[0]).toMatchObject({ status: 'completed', book: { id: book.id } });
    expect(readingList.body.total).toBe(1);
    const wishlist = await request(app.getHttpServer())
      .get('/api/reading?status=wishlist')
      .auth(first.body.accessToken, { type: 'bearer' })
      .expect(200);
    expect(wishlist.body.total).toBe(0);
    const otherList = await request(app.getHttpServer())
      .get('/api/reading')
      .auth(second.body.accessToken, { type: 'bearer' })
      .expect(200);
    expect(otherList.body.total).toBe(0);
    await request(app.getHttpServer())
      .post(path)
      .auth(first.body.accessToken, { type: 'bearer' })
      .send({ status: 'bad' })
      .expect(400);
    await request(app.getHttpServer())
      .post(path)
      .auth(first.body.accessToken, { type: 'bearer' })
      .send({ status: 'reading', userId: second.body.user.id })
      .expect(400);
    expect((await db.query('SELECT id FROM loans')).rowCount).toBe(0);
    await request(app.getHttpServer())
      .post(path)
      .auth(first.body.accessToken, { type: 'bearer' })
      .send({ status: 'none' })
      .expect(201);
    expect((await db.query('SELECT book_id FROM reading_states')).rowCount).toBe(0);
  });

  it('pagina el historial propio sin mezclar préstamos de otra cuenta', async () => {
    const owner = await register('history-owner@example.com');
    const other = await register('history-other@example.com');
    await request(app.getHttpServer())
      .post(`/api/reading/${book.id}`)
      .auth(owner.body.accessToken, { type: 'bearer' })
      .send({ status: 'reading' })
      .expect(201);
    await db.query(
      `INSERT INTO loans (id, user_id, book_id, borrowed_at, due_at, returned_at)
      SELECT gen_random_uuid(), $1, $2, now() - interval '2 days', now() + interval '21 days', now() - (n * interval '1 minute')
      FROM generate_series(1, 23) n`,
      [owner.body.user.id, book.id],
    );
    const page1 = await request(app.getHttpServer())
      .get('/api/loans/overview?page=1')
      .auth(owner.body.accessToken, { type: 'bearer' })
      .expect(200);
    const page2 = await request(app.getHttpServer())
      .get('/api/loans/overview?page=2')
      .auth(owner.body.accessToken, { type: 'bearer' })
      .expect(200);
    expect(page1.body.history.total).toBe(23);
    expect(page1.body.history.items).toHaveLength(10);
    expect(page2.body.history.items).toHaveLength(10);
    expect(
      page2.body.history.items.some((item: { id: string }) =>
        page1.body.history.items.some((first: { id: string }) => first.id === item.id),
      ),
    ).toBe(false);
    const privateList = await request(app.getHttpServer())
      .get('/api/loans/overview')
      .auth(other.body.accessToken, { type: 'bearer' })
      .expect(200);
    expect(privateList.body.history.total).toBe(0);
    await request(app.getHttpServer())
      .get('/api/loans/overview?page=1.5')
      .auth(owner.body.accessToken, { type: 'bearer' })
      .expect(400);
  });

  it('mantiene el límite de intentos de autenticación por ruta', async () => {
    for (let attempt = 0; attempt < 11; attempt++) {
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .set(headers)
        .send({ email: 'bad-email', password: 'short' })
        .expect(attempt < 10 ? 400 : 429);
    }
  });
});
