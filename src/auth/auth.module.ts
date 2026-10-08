import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AccessGuard } from './access.guard';
import { OriginGuard } from './origin.guard';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: '15m',
          issuer: 'library-hub-api',
          audience: 'library-hub-frontend',
          algorithm: 'HS256',
        },
        verifyOptions: {
          issuer: 'library-hub-api',
          audience: 'library-hub-frontend',
          algorithms: ['HS256'],
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, AccessGuard, OriginGuard],
  exports: [AccessGuard, OriginGuard, AuthService, JwtModule],
})
export class AuthModule {}
