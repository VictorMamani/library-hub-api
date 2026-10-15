import {
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
import { BorrowDto } from './loans.dto';
import { LoansService } from './loans.service';
import { PageQuery } from './page.dto';

@Controller('loans')
@UseGuards(AccessGuard)
export class LoansController {
  constructor(private readonly loans: LoansService) {}
  @Get('overview') overview(
    @Req() request: AuthenticatedRequest,
    @Query() query: PageQuery,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.loans.overview(request.user.id, query.page);
  }
  @Get()
  list(@Req() request: AuthenticatedRequest, @Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'no-store');
    return this.loans.list(request.user.id);
  }
  @Post() borrow(@Req() request: AuthenticatedRequest, @Body() input: BorrowDto) {
    return this.loans.borrow(request.user.id, input.bookId);
  }
  @Post(':id/return') returnLoan(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.loans.returnLoan(request.user.id, id);
  }
}
