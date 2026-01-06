import { fazzAdapter } from "./fazz.js";

export const adapters = {
  fazz: fazzAdapter,
};

export type AdapterName = keyof typeof adapters;