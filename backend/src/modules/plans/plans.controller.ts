import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { PlansService } from './plans.service';

@ApiTags('plans')
@Controller('plans')
export class PlansController {
  constructor(private readonly plansService: PlansService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Lista planos ativos para a página de vendas' })
  list() {
    return this.plansService.listPublic();
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Retorna um plano ativo por id' })
  findOne(@Param('id') id: string) {
    return this.plansService.findById(id);
  }
}