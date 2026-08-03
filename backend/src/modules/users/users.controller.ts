import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequestUser } from '../../common/types/auth.types';
import { CreateUserDto, ListUsersQueryDto, UpdateUserDto } from './dto/user.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
@Roles(Role.ADMIN)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @ApiOperation({ summary: 'Cria um usuário no tenant' })
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateUserDto) {
    return this.usersService.create(user.tenantId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Lista usuários do tenant' })
  list(@CurrentUser() user: RequestUser, @Query() query: ListUsersQueryDto) {
    return this.usersService.list(user.tenantId, query);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualiza um usuário do tenant' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.usersService.update(user.tenantId, id, dto, user.role);
  }
}
