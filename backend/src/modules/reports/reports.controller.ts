import { Controller, Get, Header, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestUser } from '../../common/types/auth.types';
import { ReportsService } from './reports.service';

@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('auctions')
  @ApiOperation({ summary: 'Relatório de leilões' })
  async auctions(
    @CurrentUser() user: RequestUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('groupId') groupId?: string,
  ) {
    return this.reportsService.auctionReport(user.tenantId, { from, to, groupId });
  }

  @Get('participants')
  @ApiOperation({ summary: 'Relatório de participantes' })
  async participants(@CurrentUser() user: RequestUser) {
    return this.reportsService.participantReport(user.tenantId);
  }

  @Get('groups')
  @ApiOperation({ summary: 'Relatório de grupos' })
  async groups(@CurrentUser() user: RequestUser) {
    return this.reportsService.groupReport(user.tenantId);
  }

  @Get('auctions/export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @ApiOperation({ summary: 'Exporta relatório de leilões em CSV' })
  async exportAuctions(
    @CurrentUser() user: RequestUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('groupId') groupId?: string,
  ) {
    const rows = await this.reportsService.auctionReport(user.tenantId, { from, to, groupId });
    return this.reportsService.toCsv(
      [
        'id',
        'groupName',
        'productName',
        'status',
        'initialValue',
        'finalAmount',
        'winnerName',
        'winnerPhone',
        'startedAt',
        'closedAt',
        'bidCount',
      ],
      rows,
    );
  }
}
