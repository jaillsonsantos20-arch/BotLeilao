import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Group, Role } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequestUser } from '../../common/types/auth.types';
import { CreateGroupDto, ListGroupsQueryDto, UpdateGroupDto } from './dto/group.dto';
import { GroupsService } from './groups.service';

@ApiTags('groups')
@ApiBearerAuth()
@Controller('groups')
export class GroupsController {
  constructor(private readonly groupsService: GroupsService) {}

  @Post()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Vincula um grupo do WhatsApp ao tenant' })
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateGroupDto): Promise<Group> {
    return this.groupsService.create(user.tenantId, dto, user.role);
  }

  @Post('link-code')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Gera um código para vincular grupo pelo WhatsApp' })
  linkCode(@CurrentUser() user: RequestUser) {
    return this.groupsService.generateLinkCode(user.tenantId);
  }

  @Get()
  @ApiOperation({ summary: 'Lista grupos do tenant' })
  list(@CurrentUser() user: RequestUser, @Query() query: ListGroupsQueryDto) {
    return this.groupsService.list(user.tenantId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Busca um grupo' })
  findById(@CurrentUser() user: RequestUser, @Param('id') id: string): Promise<Group> {
    return this.groupsService.findById(user.tenantId, id);
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Atualiza um grupo' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateGroupDto,
  ): Promise<Group> {
    return this.groupsService.update(user.tenantId, id, dto);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Remove um grupo' })
  async remove(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ): Promise<{ success: true }> {
    await this.groupsService.remove(user.tenantId, id);
    return { success: true };
  }
}
