import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AccessGuard } from '../auth/access.guard';
import { OriginGuard } from '../auth/origin.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { ProfilePhotoDto } from './profile.dto';
import { ProfileService } from './profile.service';

@Controller('profile/photo')
@UseGuards(AccessGuard)
export class ProfileController {
  constructor(private readonly profile: ProfileService) {}

  @Get()
  getPhoto(@Req() request: AuthenticatedRequest, @Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'no-store');
    return this.profile.getPhoto(request.user.id);
  }

  @Post()
  @HttpCode(200)
  @UseGuards(OriginGuard)
  savePhoto(@Req() request: AuthenticatedRequest, @Body() input: ProfilePhotoDto) {
    return this.profile.savePhoto(request.user.id, input.photo);
  }

  @Post('remove')
  @HttpCode(200)
  @UseGuards(OriginGuard)
  removePhoto(@Req() request: AuthenticatedRequest) {
    return this.profile.removePhoto(request.user.id);
  }
}
