import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../database/database.service';
import { InventoryService } from '../inventory/inventory.service';

interface ReservationRow {
  id: string;
  book_id: string;
  created_at: Date;
  position: number;
  ready: boolean;
  title: string;
  authors: string[];
  cover_id: number | null;
}

@Injectable()
export class ReservationsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly inventory: InventoryService,
  ) {}

  async create(userId: string, bookId: string) {
    return this.inventory.withBook(bookId, async (client) => {
      const active = await client.query<{ user_id: string }>(
        'SELECT user_id FROM loans WHERE book_id = $1 AND returned_at IS NULL',
        [bookId],
      );
      if (active.rows[0]?.user_id === userId)
        throw new ConflictException('Ya tienes este ejemplar prestado.');
      const queue = await client.query(
        "SELECT id FROM reservations WHERE book_id = $1 AND status = 'waiting'",
        [bookId],
      );
      if (!active.rowCount && !queue.rowCount)
        throw new ConflictException('El ejemplar está disponible. Puedes tomarlo prestado.');
      const existing = await client.query(
        "SELECT id FROM reservations WHERE book_id = $1 AND user_id = $2 AND status = 'waiting'",
        [bookId, userId],
      );
      if (existing.rowCount) throw new ConflictException('Ya tienes una reserva para este libro.');
      const id = randomUUID();
      await client.query('INSERT INTO reservations (id, user_id, book_id) VALUES ($1, $2, $3)', [
        id,
        userId,
        bookId,
      ]);
      return { id, bookId };
    });
  }

  async list(userId: string, page: number) {
    const pageSize = 10;
    const count = await this.db.query<{ total: number }>(
      "SELECT count(*)::int AS total FROM reservations WHERE user_id = $1 AND status = 'waiting'",
      [userId],
    );
    const result = await this.db.query<ReservationRow>(
      `WITH queue AS (
        SELECT r.*, row_number() OVER (PARTITION BY book_id ORDER BY created_at, id)::int AS position
        FROM reservations r WHERE status = 'waiting'
      ) SELECT q.id, q.book_id, q.created_at, q.position, b.title, b.authors, b.cover_id,
        (q.position = 1 AND NOT EXISTS (
          SELECT 1 FROM loans l WHERE l.book_id = q.book_id AND returned_at IS NULL
        )) AS ready
      FROM queue q JOIN books b ON b.id = q.book_id WHERE q.user_id = $1
      ORDER BY q.created_at, q.id LIMIT $2 OFFSET $3`,
      [userId, pageSize, (page - 1) * pageSize],
    );
    return {
      items: result.rows.map((row) => ({
        id: row.id,
        createdAt: row.created_at,
        position: row.position,
        ready: row.ready,
        book: { id: row.book_id, title: row.title, authors: row.authors, coverId: row.cover_id },
      })),
      total: count.rows[0].total,
      page,
      pageSize,
    };
  }

  async bookState(userId: string, bookId: string) {
    const result = await this.db.query<{ id: string; position: number; ready: boolean }>(
      `WITH queue AS (
        SELECT id, user_id, row_number() OVER (ORDER BY created_at, id)::int AS position
        FROM reservations WHERE book_id = $1 AND status = 'waiting'
      ) SELECT id, position, (position = 1 AND NOT EXISTS (
        SELECT 1 FROM loans WHERE book_id = $1 AND returned_at IS NULL
      )) AS ready FROM queue WHERE user_id = $2`,
      [bookId, userId],
    );
    const loan = await this.db.query(
      'SELECT id FROM loans WHERE book_id = $1 AND user_id = $2 AND returned_at IS NULL',
      [bookId, userId],
    );
    return { reservation: result.rows[0] ?? null, borrowedByMe: Boolean(loan.rowCount) };
  }

  async cancel(userId: string, id: string) {
    const result = await this.db.query<{ book_id: string }>(
      "SELECT book_id FROM reservations WHERE id = $1 AND user_id = $2 AND status = 'waiting'",
      [id, userId],
    );
    if (!result.rowCount)
      throw new NotFoundException('No se encontró una reserva activa de tu cuenta.');
    return this.inventory.withBook(result.rows[0].book_id, async (client) => {
      const cancelled = await client.query(
        "UPDATE reservations SET status = 'cancelled', closed_at = now() WHERE id = $1 AND user_id = $2 AND status = 'waiting' RETURNING id",
        [id, userId],
      );
      if (!cancelled.rowCount)
        throw new NotFoundException('No se encontró una reserva activa de tu cuenta.');
      return { id };
    });
  }
}
