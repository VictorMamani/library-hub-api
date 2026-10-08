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
      .useValue({ detail: jest.fn().mockResolvedValue(book) })
      .compile();
    app = module.createNestApplication();
    configureApplication(app);
    await app.init();
    db = app.get(DatabaseService);
  });

  beforeEach(async () => {
    app.get<ThrottlerStorageService>(ThrottlerStorage).onApplicationShutdown();
    await db.query('TRUNCATE profile_photos, loans, sessions, books, users');
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
