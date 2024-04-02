import { SubscriberArgs, SubscriberConfig } from "@medusajs/medusa";
import ResendService from "../services/resend";
import { EventData } from "../types";

export default async function restockHandler({
  data,
  container,
}: SubscriberArgs<EventData>) {
  const resendService: ResendService = container.resolve("resend");

  const templateId = await resendService.getTemplateId(
    "restock-notification.restocked"
  );

  if (!templateId) {
    return;
  }

  const fetchedData = await resendService.fetchData(
    "restock-notification.restocked",
    data,
    null
  );

  if (!data.emails) {
    return;
  }

  return await Promise.all(
    fetchedData.emails.map(async (e) => {
      return await resendService.sendEmail(
        templateId,
        resendService.options_.from,
        e,
        fetchedData
      );
    })
  );
}

export const config: SubscriberConfig = {
  event: "restock-notification.restocked",
  context: {
    subscriberId: "restock-handler",
  },
};
