import { apply, Metadata, propMetadata } from "@decaf-ts/decoration";
import {
  innerValidationDecorator,
  validator,
  Validator,
  ValidatorOptions,
} from "@decaf-ts/decorator-validation";
import { CronExpressionParser } from "cron-parser";

const CRON_VALIDATION_KEY = "cron";
export const CRON_VALIDATION_ERROR_MESSAGE = "Not a valid cron expression";

@validator(CRON_VALIDATION_KEY)
export class CronValidator extends Validator {
  constructor(message: string = CRON_VALIDATION_ERROR_MESSAGE) {
    super(message, "string");
  }

  hasErrors(value: string, options?: ValidatorOptions): string | undefined {
    if (value === undefined || value === null) return;

    const cron = value.trim();

    if (!cron) {
      return this.getMessage(options?.message || this.message);
    }

    try {
      CronExpressionParser.parse(cron);
      return;
    } catch {
      return this.getMessage(options?.message || this.message);
    }
  }
}

export const cron = (message: string = CRON_VALIDATION_ERROR_MESSAGE) => {
  return function cron(target: object, propKey?: any) {
    return apply(
      propMetadata(Metadata.key(CRON_VALIDATION_KEY, propKey), message),
      innerValidationDecorator(cron, CRON_VALIDATION_KEY, {
        message,
        async: false,
      })
    )(target, propKey);
  };
};
