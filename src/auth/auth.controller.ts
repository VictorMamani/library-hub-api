import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto, RegisterDto } from './auth.dto';
import { OriginGuard } from './origin.guard';
import { AccessGuard } from './access.guard';
import type { AuthenticatedRequest } from './auth.types';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  private cookieOptions() {
    return {
      httpOnly: true,
      secure: this.config.get<string>('NODE_ENV') === 'production',
      sameSite: 'strict' as const,
      path: '/api/auth',
    };
  }

  private respond(response: Response, result: Awaited<ReturnType<AuthService['login']>>) {
    response.setHeader('Cache-Control', 'no-store');
    response.cookie('library_refresh', result.refreshToken, {
      ...this.cookieOptions(),
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    return { user: result.user, accessToken: result.accessToken };
  }

  @Post('register')
  @UseGuards(OriginGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async register(@Body() input: RegisterDto, @Res({ passthrough: true }) response: Response) {
    return this.respond(response, await this.auth.register(input));
  }

  @Post('login')
  @HttpCode(200)
  @UseGuards(OriginGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async login(@Body() input: LoginDto, @Res({ passthrough: true }) response: Response) {
    return this.respond(response, await this.auth.login(input));
  }

  @Post('refresh')
  @HttpCode(200)
  @UseGuards(OriginGuard)
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'no-store');
    if (!request.cookies?.library_refresh) {
      response.status(204);
      return;
    }
    return this.respond(response, await this.auth.refresh(request.cookies?.library_refresh));
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(OriginGuard)
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    await this.auth.logout(request.cookies?.library_refresh);
    response.clearCookie('library_refresh', this.cookieOptions());
    response.setHeader('Cache-Control', 'no-store');
  }

  @Get('me')
  @UseGuards(AccessGuard)
  me(@Req() request: AuthenticatedRequest, @Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'no-store');
    return request.user;
  }
}
