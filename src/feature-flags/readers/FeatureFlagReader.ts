import {
  FEATURE_FLAG_ENV_ROOT,
} from "../constants";
import {
  loadFeatureFlagsFromEnvironment,
} from "../environment";
import type {
  FeatureFlagEnvironmentShape,
  FeatureFlagReaderInput,
  FeatureFlagRegistry,
  FeatureFlagValue,
} from "../types";
import { normalizeFeatureName } from "../utils";

export abstract class FeatureFlagReader {
  abstract read(
    input?: FeatureFlagReaderInput
  ): Promise<FeatureFlagRegistry>;

  async readOne(
    featureName: string,
    input?: FeatureFlagReaderInput
  ): Promise<FeatureFlagValue | undefined> {
    const registry = await this.read(input);
    return registry[normalizeFeatureName(featureName)];
  }
}

export class EnvironmeFlagReader extends FeatureFlagReader {
  async read(
    input: FeatureFlagReaderInput = {}
  ): Promise<FeatureFlagRegistry> {
    const environment =
      (input.source as FeatureFlagEnvironmentShape | undefined) ??
      ({
        [FEATURE_FLAG_ENV_ROOT]: {},
      } as FeatureFlagEnvironmentShape);
    return loadFeatureFlagsFromEnvironment(environment);
  }
}

export type FeatureFlagReaderConstructor = new () => FeatureFlagReader;
export type FeatureFlagReaderLike =
  | FeatureFlagReader
  | FeatureFlagReaderConstructor;
