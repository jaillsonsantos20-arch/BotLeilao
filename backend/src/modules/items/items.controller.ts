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
import { Role } from '@prisma/client';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { mkdirSync, writeFileSync } from 'fs';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequestUser } from '../../common/types/auth.types';
import { CreateItemDto, ListItemsQueryDto, StartItemAuctionDto } from './dto/item.dto';
import { ItemsService } from './items.service';

const UPLOAD_ITEMS_DIR = join(process.cwd(), 'uploads', 'items');
mkdirSync(UPLOAD_ITEMS_DIR, { recursive: true });

const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

interface ImageSignature {
  ext: string;
  check: (buffer: Buffer) => boolean;
}

const IMAGE_SIGNATURES: ImageSignature[] = [
  {
    ext: '.jpg',
    check: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    ext: '.png',
    check: (b) =>
      b.length >= 8 &&
      b.readUInt32BE(0) === 0x89504e47 &&
      b.readUInt32BE(4) === 0x0d0a1a0a,
  },
  {
    ext: '.gif',
    check: (b) => {
      const head = b.length >= 6 ? b.toString('ascii', 0, 6) : '';
      return head === 'GIF87a' || head === 'GIF89a';
    },
  },
  {
    ext: '.webp',
    check: (b) =>
      b.length >= 12 &&
      b.toString('ascii', 0, 4) === 'RIFF' &&
      b.toString('ascii', 8, 12) === 'WEBP',
  },
];

function detectImageExtension(buffer: Buffer): string | null {
  for (const signature of IMAGE_SIGNATURES) {
    if (signature.check(buffer)) {
      return signature.ext;
    }
  }
  return null;
}

@ApiTags('items')
@ApiBearerAuth()
@Controller('items')
export class ItemsController {
  constructor(private readonly itemsService: ItemsService) {}

  @Post()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Cadastra um novo item para leilão' })
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateItemDto) {
    return this.itemsService.create(user.tenantId, dto);
  }

  @Post('upload-image')
  @Roles(Role.ADMIN)
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
      mimetype: string;
      buffer: Buffer;
    },
  ) {
    if (!file) {
      throw new BadRequestException('Envie um arquivo de imagem no campo "file".');
    }

    const ext = detectImageExtension(file.buffer);
    if (!ext) {
      throw new BadRequestException(
        'O arquivo não é uma imagem válida (JPEG, PNG, WebP ou GIF).',
      );
    }

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
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Remove um item cadastrado' })
  async remove(@CurrentUser() user: RequestUser, @Param('id') id: string): Promise<{ success: true }> {
    await this.itemsService.remove(user.tenantId, id);
    return { success: true };
  }

  @Post(':id/auction')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Inicia o leilão do item no WhatsApp' })
  startAuctionOnWhatsApp(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: StartItemAuctionDto,
  ) {
    return this.itemsService.startAuctionOnWhatsApp(user.tenantId, id, dto, user.id);
  }
}
