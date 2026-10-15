import { Injectable, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { CatalogService } from '../catalog/catalog.service';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class InventoryService {
  constructor(
    private readonly db: DatabaseService,
    private readonly catalog: CatalogService,
  ) {}

  async ensureBook(bookId: string) {
    const book = await this.catalog.detail(bookId);
    await this.db.query(
      `INSERT INTO books (id, title, authors, cover_id, publication_year, subjects, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING`,
      [
        book.id,
        book.title,
        JSON.stringify(book.authors),
        book.coverId,
        book.publicationYear,
        JSON.stringify(book.subjects),
        book.description,
      ],
    );
  }

  async withBook<T>(bookId: string, action: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.db.pool.connect();
    try {
      await client.query('BEGIN');
      const book = await client.query('SELECT id FROM books WHERE id = $1 FOR UPDATE', [bookId]);
      if (!book.rowCount) throw new NotFoundException('No se encontró el ejemplar.');
      const result = await action(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
