import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AccessGuard } from '../auth/access.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { ReadingDto } from './reading.dto';
import { ReadingService } from './reading.service';
import { ReadingQuery } from './reading-query.dto';

@Controller('reading')
@UseGuards(AccessGuard)
export class ReadingController {
  constructor(private readonly reading: ReadingService) {}

  @Get() list(
    @Req() request: AuthenticatedRequest,
    @Query() query: ReadingQuery,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.reading.list(request.user.id, query);
  }

  private bookId(id: string) {
    if (!/^OL\d+W$/.test(id)) throw new BadRequestException('Identificador de libro no válido.');
    return id;
  }

  @Get(':bookId') get(
    @Req() request: AuthenticatedRequest,
    @Param('bookId') id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.reading.get(request.user.id, this.bookId(id));
  }

  @Post(':bookId') set(
    @Req() request: AuthenticatedRequest,
    @Param('bookId') id: string,
    @Body() input: ReadingDto,
  ) {
    return this.reading.set(request.user.id, this.bookId(id), input.status);
  }
}
