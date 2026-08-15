import { Global, Module } from '@nestjs/common';
import { PlanLimitsService } from './plan-limits.service';

/**
 * Módulo global de limites de plano — injetável em qualquer módulo sem importação.
 */
@Global()
@Module({
  providers: [PlanLimitsService],
  exports: [PlanLimitsService],
})
export class PlanLimitsModule {}