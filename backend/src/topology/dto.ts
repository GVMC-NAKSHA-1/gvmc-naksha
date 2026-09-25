import { IsBoolean, IsIn, IsNumber, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class RunTopologyDto {
  @IsUUID() sourceId!: string;
  @IsOptional() @IsNumber() @Min(0) @Max(5) toleranceM?: number;
  @IsOptional() @IsNumber() @Min(0.1) @Max(10) gapMaxWidthM?: number;
  @IsOptional() @IsNumber() @Min(0.05) @Max(5) sliverMaxWidthM?: number;
  @IsOptional() @IsNumber() @Min(0) overlapMinSqm?: number;
  @IsOptional() @IsBoolean() autoFix?: boolean;
}

export class ResolveIssueDto {
  @IsIn(['accept_fix', 'ignore', 'reopen']) action!: string;
}
