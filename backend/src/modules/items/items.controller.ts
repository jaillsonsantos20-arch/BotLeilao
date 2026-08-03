import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { randomUUID } from 'crypto';
import { extname, join } from 'path';
import { mkdirSync, writeFileSync } from 'fs';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestUser } from '../../common/types/auth.types';
import { CreateItemDto, ListItemsQueryDto, StartItemAuctionDto } from './dto/item.dto';
import { ItemsService } from './items.service';

const UPLOAD_ITEMS_DIR = join(process.cwd(), 'uploads', 'items');
mkdirSync(UPLOAD_ITEMS_DIR, { recursive: true });

const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

@ApiTags('items')
@ApiBearerAuth()
@Controller('items')
export class ItemsController {
  constructor(private readonly itemsService: ItemsService) {}

  @Post()
  @ApiOperation({ summary: 'Cadastra um novo item para leilão' })
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateItemDto) {
    return this.itemsService.create(user.tenantId, dto);
  }

  @Post('upload-image')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Envia a foto do item (JPEG/PNG/WebP/GIF, até 5MB)' })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (IMAGE_MIME_TYPES.has(file.mimetype)) {
          cb(null, true);
          return;
        }
        cb(new BadRequestException('Formato de imagem inválido. Use JPEG, PNG, WebP ou GIF.'), false);
      },
    }),
  )
  uploadImage(
    @UploadedFile()
    file?: {
      originalname: string;
      mimetype: string;
      buffer: Buffer;
    },
  ) {
    if (!file) {
      throw new BadRequestException('Envie um arquivo de imagem no campo "file".');
    }

    const ext = extname(file.originalname).toLowerCase() || '.jpg';
    const filename = `${randomUUID()}${ext}`;
    writeFileSync(join(UPLOAD_ITEMS_DIR, filename), file.buffer);

    return { url: `/api/uploads/items/${filename}` };
  }

  @Get()
  @ApiOperation({ summary: 'Lista os itens cadastrados' })
  list(@CurrentUser() user: RequestUser, @Query() query: ListItemsQueryDto) {
    return this.itemsService.list(user.tenantId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Busca um item pelo id' })
  findById(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.itemsService.findById(user.tenantId, id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove um item cadastrado' })
  async remove(@CurrentUser() user: RequestUser, @Param('id') id: string): Promise<{ success: true }> {
    await this.itemsService.remove(user.tenantId, id);
    return { success: true };
  }

  @Post(':id/auction')
  @ApiOperation({ summary: 'Inicia o leilão do item no WhatsApp' })
  startAuctionOnWhatsApp(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: StartItemAuctionDto,
  ) {
    return this.itemsService.startAuctionOnWhatsApp(user.tenantId, id, dto, user.id);
  }
}
