import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AccessGuard } from '../auth/access.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { BorrowDto } from '../loans/loans.dto';
import { PageQuery } from '../loans/page.dto';
import { ReservationsService } from './reservations.service';

@Controller('reservations')
@UseGuards(AccessGuard)
export class ReservationsController {
  constructor(private readonly reservations: ReservationsService) {}

  @Get() list(
    @Req() request: AuthenticatedRequest,
    @Query() query: PageQuery,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.reservations.list(request.user.id, query.page);
  }

  @Get('book/:bookId') bookState(
    @Req() request: AuthenticatedRequest,
    @Param('bookId') bookId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (!/^OL\d+W$/.test(bookId))
      throw new BadRequestException('Identificador de libro no válido.');
    response.setHeader('Cache-Control', 'no-store');
    return this.reservations.bookState(request.user.id, bookId);
  }

  @Post() create(@Req() request: AuthenticatedRequest, @Body() input: BorrowDto) {
    return this.reservations.create(request.user.id, input.bookId);
  }

  @Post(':id/cancel') cancel(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.reservations.cancel(request.user.id, id);
  }
}
