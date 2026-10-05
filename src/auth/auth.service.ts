import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { DatabaseService } from '../database/database.service';
import { LoginDto, RegisterDto } from './auth.dto';
import { hashPassword, verifyPassword } from './password';
import type { User } from './auth.types';

interface UserRow extends User {
  password_hash: string;
}

const digest = (token: string) => createHash('sha256').update(token).digest('hex');

@Injectable()
export class AuthService {
  private dummyHash?: Promise<string>;

  constructor(
    private readonly db: DatabaseService,
    private readonly jwt: JwtService,
  ) {}

  async register(input: RegisterDto) {
    const user: User = { id: randomUUID(), name: input.name, email: input.email };
    const passwordHash = await hashPassword(input.password);
    try {
      await this.db.query(
        'INSERT INTO users (id, name, email, password_hash) VALUES ($1, $2, $3, $4)',
        [user.id, user.name, user.email, passwordHash],
      );
    } catch (error) {
      if ((error as { code?: string }).code === '23505')
        throw new ConflictException('Ya existe una cuenta con ese correo.');
      throw error;
    }
    return this.createSession(user);
  }

  async login(input: LoginDto) {
    const result = await this.db.query<UserRow>(
      'SELECT id, name, email, password_hash FROM users WHERE email = $1',
      [input.email],
    );
    const user = result.rows[0];
    this.dummyHash ??= hashPassword(randomBytes(32).toString('hex'));
    const valid = await verifyPassword(
      input.password,
      user?.password_hash ?? (await this.dummyHash),
    );
    if (!user || !valid) throw new UnauthorizedException('Correo o contraseña incorrectos.');
    return this.createSession({ id: user.id, name: user.name, email: user.email });
  }

  private async createSession(user: User) {
    const sessionId = randomUUID();
    const refreshToken = randomBytes(32).toString('base64url');
    await this.db.query(
      "INSERT INTO sessions (id, user_id, refresh_hash, expires_at) VALUES ($1, $2, $3, now() + interval '7 days')",
      [sessionId, user.id, digest(refreshToken)],
    );
    const accessToken = await this.jwt.signAsync({ sub: user.id, sid: sessionId });
    return { user, accessToken, refreshToken };
  }

  async refresh(token: unknown) {
    if (typeof token !== 'string' || token.length > 200)
      throw new UnauthorizedException('La sesión terminó. Inicia sesión nuevamente.');
    const refreshToken = randomBytes(32).toString('base64url');
    const result = await this.db.query<User & { session_id: string }>(
      `WITH renewed AS (
        UPDATE sessions SET refresh_hash = $1
        WHERE refresh_hash = $2 AND expires_at > now()
        RETURNING id, user_id
      ) SELECT u.id, u.name, u.email, r.id AS session_id FROM renewed r JOIN users u ON u.id = r.user_id`,
      [digest(refreshToken), digest(token)],
    );
    const row = result.rows[0];
    if (!row) throw new UnauthorizedException('La sesión terminó. Inicia sesión nuevamente.');
    const user: User = { id: row.id, name: row.name, email: row.email };
    const accessToken = await this.jwt.signAsync({ sub: user.id, sid: row.session_id });
    return { user, accessToken, refreshToken };
  }

  async logout(token: unknown) {
    if (typeof token === 'string' && token.length <= 200)
      await this.db.query('DELETE FROM sessions WHERE refresh_hash = $1', [digest(token)]);
  }

  async getSession(userId: string, sessionId: string) {
    const result = await this.db.query<User>(
      'SELECT u.id, u.name, u.email FROM users u JOIN sessions s ON s.user_id = u.id WHERE u.id = $1 AND s.id = $2 AND s.expires_at > now()',
      [userId, sessionId],
    );
    const user = result.rows[0];
    if (!user) throw new UnauthorizedException('La sesión terminó.');
    return user;
  }
}
