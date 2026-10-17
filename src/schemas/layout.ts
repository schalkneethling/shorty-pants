import { z } from "zod";
import { layoutNames } from "./layout-names.ts";

export const layoutSchema = z.enum(layoutNames);

export type { Layout } from "./layout-names.ts";
