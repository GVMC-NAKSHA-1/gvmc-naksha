import { IsIn, IsObject, IsOptional, IsUUID } from 'class-validator';

export class RunExtractionDto {
  @IsUUID() sourceId!: string;
  @IsOptional() @IsIn(['auto', 'ndsm', 'model', 'classical']) method?: string;
  @IsOptional() @IsObject() params?: Record<string, number>;
}

