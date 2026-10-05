import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

@Injectable()
export class OriginGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    if (
      request.headers.origin !== this.config.getOrThrow<string>('APP_ORIGIN') ||
      request.headers['x-library-client'] !== 'web'
    ) {
      throw new ForbiddenException('Origen de la solicitud no permitido.');
    }
    return true;
  }
}
