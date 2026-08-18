import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class DeclareBranchDepositDto {
  @IsString()
  @IsNotEmpty({ message: 'accountId is required' })
  accountId!: string;

  @IsNotEmpty({ message: 'amount is required' })
  amount!: string | number;

  /**
   * The reference printed on the physical deposit slip. Required, and unique
   * platform-wide — it is the only thing a manager can check a customer's
   * claim against, and it stops one slip being claimed twice.
   */
  @IsString()
  @MinLength(4, { message: 'Enter the reference from your deposit slip' })
  @MaxLength(40)
  @Matches(/^[A-Za-z0-9-]+$/, {
    message: 'Slip reference may only contain letters, numbers and dashes',
  })
  slipReference!: string;

  @IsString()
  @MinLength(2, { message: 'Which branch did you pay in at?' })
  @MaxLength(80)
  branchName!: string;

  @IsOptional()
  @IsDateString({}, { message: 'depositedAt must be a date' })
  depositedAt?: string;
}

export class RequestBranchWithdrawalDto {
  @IsString()
  @IsNotEmpty({ message: 'accountId is required' })
  accountId!: string;

  @IsNotEmpty({ message: 'amount is required' })
  amount!: string | number;

  @IsString()
  @MinLength(2, { message: 'Which branch will you collect from?' })
  @MaxLength(80)
  branchName!: string;
}

export class DecideMovementDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}

export class RejectMovementDto {
  @IsString()
  @MinLength(5, { message: 'Give a reason the customer can act on' })
  @MaxLength(200)
  reason!: string;
}

export class MovementQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 25;
}

export class MomoDepositDto {
  @IsString()
  @IsNotEmpty({ message: 'accountId is required' })
  accountId!: string;

  @IsNotEmpty({ message: 'amount is required' })
  amount!: string | number;

  /**
   * Supplied by the client so a double-tap or a retried request returns the
   * original movement rather than starting a second collection.
   */
  @IsString()
  @MinLength(8, { message: 'idempotencyKey must be at least 8 characters' })
  @MaxLength(64)
  idempotencyKey!: string;
}

export class MomoWithdrawalDto {
  @IsString()
  @IsNotEmpty({ message: 'accountId is required' })
  accountId!: string;

  @IsNotEmpty({ message: 'amount is required' })
  amount!: string | number;

  @IsString()
  @MinLength(8, { message: 'idempotencyKey must be at least 8 characters' })
  @MaxLength(64)
  idempotencyKey!: string;
}
