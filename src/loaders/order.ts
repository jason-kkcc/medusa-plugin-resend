import { MedusaContainer, NotificationService } from "@medusajs/medusa";

export default async (container: MedusaContainer): Promise<void> => {
  const notificationService = container.resolve<NotificationService>(
    "notificationService"
  );

  notificationService.subscribe("order.shipment_created", "resend");
  notificationService.subscribe("order.gift_card_created", "resend");
  notificationService.subscribe("gift_card.created", "resend");
  notificationService.subscribe("order.placed", "resend");
  notificationService.subscribe("order.canceled", "resend");
  notificationService.subscribe("customer.password_reset", "resend");
  notificationService.subscribe("claim.shipment_created", "resend");
  notificationService.subscribe("swap.shipment_created", "resend");
  notificationService.subscribe("swap.created", "resend");
  notificationService.subscribe("order.items_returned", "resend");
  notificationService.subscribe("order.return_requested", "resend");
  notificationService.subscribe("order.refund_created", "resend");
};
