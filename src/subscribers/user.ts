import { SubscriberArgs, SubscriberConfig } from "@medusajs/medusa";
import { EventData } from "../types";
import ResendService from "../services/resend";

export default async function userHandler({
  data,
  container,
}: SubscriberArgs<EventData>) {
  const resendService: ResendService = container.resolve("resend");

  if (!data) {
    return;
  }

  return await resendService.sendNotification(
    "user.password_reset",
    data,
    null
  );
}

export const config: SubscriberConfig = {
  event: "user.password_reset",
  context: {
    subscriberId: "user-handler-notification",
  },
};
