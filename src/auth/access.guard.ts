import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import type { AuthenticatedRequest, SessionClaims } from './auth.types';

@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith('Bearer '))
      throw new UnauthorizedException('Inicia sesión para continuar.');
    try {
      const claims = await this.jwt.verifyAsync<SessionClaims>(authorization.slice(7));
      if (typeof claims.sub !== 'string' || typeof claims.sid !== 'string')
        throw new Error('Invalid claims');
      request.user = await this.auth.getSession(claims.sub, claims.sid);
      request.sessionId = claims.sid;
      return true;
    } catch {
      throw new UnauthorizedException('La sesión terminó. Inicia sesión nuevamente.');
    }
  }
}
