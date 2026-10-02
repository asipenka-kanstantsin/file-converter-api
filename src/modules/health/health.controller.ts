import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ZodSerializerDto } from 'nestjs-zod';

import { type HealthReport, HealthReportDto } from './dto/health-report.dto';
import { HealthService } from './health.service';

@Controller('health')
@SkipThrottle()
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ZodSerializerDto(HealthReportDto)
  check(): Promise<HealthReport> {
    return this.healthService.check();
  }

  @Get('live')
  @ZodSerializerDto(HealthReportDto)
  live(): HealthReport {
    return this.healthService.live();
  }

  @Get('ready')
  @ZodSerializerDto(HealthReportDto)
  ready(): Promise<HealthReport> {
    return this.healthService.check();
  }
}
