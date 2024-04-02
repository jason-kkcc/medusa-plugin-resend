import { LineItem, ReturnItem } from "@medusajs/medusa";
import * as React from "react";

export interface EventData {
  id: string;
  return_id?: string;
  refund_id?: string;
  fulfillment_id?: string;
  variant_id?: string;
  emails?: string[];
}

export interface Attachment {
  name: string;
  base64: string;
  type: string;
}

interface ResendAttachment {
  content?: string | Buffer;
  filename?: string | false | undefined;
  path?: string;
}

export interface ResendOptions {
  to: string | string[];
  from: string;
  subject?: string | null;
  react?: React.ReactElement | React.ReactNode | null;
  html?: string;
  text?: string;
  attachments?: ResendAttachment[];
}

export type PricedLineItem = Omit<
  LineItem,
  "beforeUpdate" | "afterUpdateOrLoad"
> & {
  totals: any;
  thumbnail: string | null;
  discounted_price: string;
  price: string;
};

export type PricedReturnItem = Omit<
  ReturnItem,
  "beforeUpdate" | "afterUpdateOrLoad"
> & {
  totals: any;
  price: string;
  tax_lines: any;
  thumbnail: string | null;
};
