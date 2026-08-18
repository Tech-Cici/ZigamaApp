import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * `amount` is intentionally typed loosely and validated in the service by
 * `parseAmountToMinor`, which is the single place that decides what a valid
 * money value is (positive, at most 2 decimal places, within limits).
 */

export class DepositDto {
  @IsString()
  @IsNotEmpty({ message: 'accountId is required' })
  accountId!: string;

  @IsNotEmpty({ message: 'amount is required' })
  amount!: string | number;

  @IsOptional()
  @IsString()
  @MaxLength(140)
  description?: string;
}

export class WithdrawDto {
  @IsString()
  @IsNotEmpty({ message: 'accountId is required' })
  accountId!: string;

  @IsNotEmpty({ message: 'amount is required' })
  amount!: string | number;

  @IsOptional()
  @IsString()
  @MaxLength(140)
  description?: string;
}

export class TransferDto {
  @IsString()
  @IsNotEmpty({ message: 'fromAccountId is required' })
  fromAccountId!: string;

  @IsString()
  @Matches(/^\d{10}$/, { message: 'Recipient account number must be 10 digits' })
  toAccountNumber!: string;

  @IsNotEmpty({ message: 'amount is required' })
  amount!: string | number;

  @IsOptional()
  @IsString()
  @MaxLength(140)
  description?: string;
}

export class HistoryQueryDto {
  @IsOptional()
  @IsString()
  accountId?: string;

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
  limit?: number = 20;
}
