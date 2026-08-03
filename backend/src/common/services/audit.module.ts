import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';

/**
 * Módulo global de auditoria — injetável em qualquer módulo sem importação.
 */
@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
