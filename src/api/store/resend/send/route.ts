import type { MedusaRequest, MedusaResponse } from "@medusajs/medusa";
import { IsString } from "class-validator";
import ResendService from "../../../../services/resend";

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const resendService: ResendService = req.scope.resolve("resend");

  const data = req.validatedBody as StoreResendSendRequest;

  resendService
    .sendEmail(data.template_id, data.from, data.to, data.data)
    .then((result) => {
      return res.json({
        result,
      });
    });
}

export class StoreResendSendRequest {
  @IsString()
  template_id?: string;

  @IsString()
  from?: string;

  @IsString()
  to?: string;

  data?: Record<string, unknown>;
}
