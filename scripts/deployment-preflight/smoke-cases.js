import { productionCases } from "./smoke-production-cases.js";
import { sharedPocCases } from "./smoke-shared-poc-cases.js";

export const cases = [...sharedPocCases, ...productionCases];
