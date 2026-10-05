import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AccessGuard } from '../auth/access.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { BorrowDto } from './loans.dto';
import { LoansService } from './loans.service';

@Controller('loans')
@UseGuards(AccessGuard)
export class LoansController {
  constructor(private readonly loans: LoansService) {}
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
