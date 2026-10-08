import { BadRequestException, Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class ProfileService {
  constructor(private readonly db: DatabaseService) {}

  async getPhoto(userId: string) {
    const result = await this.db.query<{ photo: string }>(
      'SELECT photo FROM profile_photos WHERE user_id = $1',
      [userId],
    );
    return { photo: result.rows[0]?.photo ?? null };
  }

  async savePhoto(userId: string, photo: string) {
    const encoded = photo.slice('data:image/jpeg;base64,'.length);
    const bytes = Buffer.from(encoded, 'base64');
    if (
      bytes.length > 65536 ||
      bytes.length < 4 ||
      bytes.toString('base64') !== encoded ||
      bytes[0] !== 0xff ||
      bytes[1] !== 0xd8 ||
      bytes[2] !== 0xff ||
      bytes[bytes.length - 2] !== 0xff ||
      bytes[bytes.length - 1] !== 0xd9
    ) {
      throw new BadRequestException(
        'Selecciona una foto JPEG válida de hasta 64 KB después de prepararla.',
      );
    }
    await this.db.query(
      'INSERT INTO profile_photos (user_id, photo) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET photo = EXCLUDED.photo',
      [userId, photo],
    );
    return { photo };
  }

  async removePhoto(userId: string) {
    await this.db.query('DELETE FROM profile_photos WHERE user_id = $1', [userId]);
    return { photo: null };
  }
}
