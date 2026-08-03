import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestUser } from '../../common/types/auth.types';
import { DashboardService } from './dashboard.service';
import { DashboardFiltersDto, TimeSeriesQueryDto } from './dto/dashboard.dto';

@ApiTags('dashboard')
@ApiBearerAuth()
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('summary')
  @ApiOperation({ summary: 'Cards de resumo do tenant' })
  summary(@CurrentUser() user: RequestUser, @Query() filters: DashboardFiltersDto) {
    return this.dashboardService.summary(user.tenantId, filters);
  }

  @Get('auctions-over-time')
  @ApiOperation({ summary: 'Leilões encerrados por dia' })
  auctionsOverTime(@CurrentUser() user: RequestUser, @Query() query: TimeSeriesQueryDto) {
    return this.dashboardService.auctionsOverTime(user.tenantId, query.days ?? 30);
  }

  @Get('bids-over-time')
  @ApiOperation({ summary: 'Lances por dia' })
  bidsOverTime(@CurrentUser() user: RequestUser, @Query() query: TimeSeriesQueryDto) {
    return this.dashboardService.bidsOverTime(user.tenantId, query.days ?? 30);
  }

  @Get('top-products')
  @ApiOperation({ summary: 'Produtos com maior receita' })
  topProducts(
    @CurrentUser() user: RequestUser,
    @Query('limit') limit?: string,
  ) {
    return this.dashboardService.topProducts(
      user.tenantId,
      limit ? Math.min(parseInt(limit, 10), 20) : 5,
    );
  }
}
