import { Resend } from "resend";
import Handlebars from "handlebars";
import path from "path";
import fs from "fs";
import { humanizeAmount, zeroDecimalCurrencies } from "medusa-core-utils";
import { MedusaError } from "@medusajs/utils";
import {
  AbstractNotificationService,
  CartService,
  ClaimService,
  FulfillmentProviderService,
  GiftCardService,
  LineItem,
  LineItemService,
  Order,
  OrderService,
  ProductVariantService,
  ReturnService,
  StoreService,
  SwapService,
  TotalsService,
} from "@medusajs/medusa";
import {
  Attachment,
  EventData,
  PricedLineItem,
  PricedReturnItem,
  ResendOptions,
} from "../types";
import { FulfillmentService } from "@medusajs/medusa/dist/services";

class ResendService extends AbstractNotificationService {
  static identifier = "resend";
  public options_: any;
  protected templatePath_: string;
  protected fulfillmentProviderService_: FulfillmentProviderService;
  protected storeService_: StoreService;
  protected lineItemService_: LineItemService;
  protected orderService_: OrderService;
  protected cartService_: CartService;
  protected claimService_: ClaimService;
  protected returnService_: ReturnService;
  protected swapService_: SwapService;
  protected fulfillmentService_: FulfillmentService;
  protected totalsService_: TotalsService;
  protected productVariantService_: ProductVariantService;
  protected giftCardService_: GiftCardService;
  protected transporter_: Resend;

  /**
   * @param {Object} options - options defined in `medusa-config.js`
   *    e.g.
   *    {
   *      api_key: process.env.RESEND_API_KEY,
   *      from: process.env.RESEND_FROM,
   *      enable_endpoint: process.env.RESEND_ENABLE_ENDPOINT,
   *		 subject_template_type: process.env.RESEND_SUBJECT_TEMPLATE_TYPE,
   *		 body_template_type: process.env.RESEND_BODY_TEMPLATE_TYPE,
   *      template_path: process.env.RESEND_TEMPLATE_PATH,
   *      order_placed_template: 'order_placed',
   *		 order_shipped_template: 'order_shipped',
   *		 customer_password_reset_template: 'customer_password_reset',
   *		 gift_card_created_template: 'gift_card_created',
   *		 order_canceled_template: 'order_canceled',
   *		 order_refund_created_template: 'order_refund_created',
   *		 order_return_requested_template: 'order_return_requested',
   *		 order_items_returned_template: 'order_items_returned',
   *		 swap_created_template: 'swap_created',
   *		 swap_shipment_created_template: 'swap_shipment_created',
   *		 swap_received_template: 'swap_received',
   *		 claim_shipment_created_template: 'claim_shipment_created',
   *		 user_password_reset_template: 'user_password_reset',
   *		 medusa_restock_template: 'medusa_restock',
   *    }
   */
  constructor(container, options) {
    super(container);

    this.options_ = options;
    this.templatePath_ = this.options_.template_path.startsWith("/")
      ? path.resolve(this.options_.template_path) // The path given in options is absolute
      : path.join(__dirname, "../../../..", this.options_.template_path); // The path given in options is relative

    this.fulfillmentProviderService_ = container.fulfillmentProviderService;
    this.storeService_ = container.storeService;
    this.lineItemService_ = container.lineItemService;
    this.orderService_ = container.orderService;
    this.cartService_ = container.cartService;
    this.claimService_ = container.claimService;
    this.returnService_ = container.returnService;
    this.swapService_ = container.swapService;
    this.fulfillmentService_ = container.fulfillmentService;
    this.totalsService_ = container.totalsService;
    this.productVariantService_ = container.productVariantService;

    this.transporter_ = new Resend(this.options_.api_key);
  }

  async sendNotification(
    event: string,
    eventData: EventData,
    attachmentGenerator?: any
  ): Promise<{
    to: string;
    status: string;
    data: Record<string, unknown>;
  }> {
    let templateId = this.getTemplateId(event);
    if (!templateId) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Resend service: No template was set for this event"
      );
    }

    let data;
    if ((eventData as any)?.origin === true) {
      data = eventData;
    } else {
      data = await this.fetchData(event, eventData, attachmentGenerator);
    }

    if (!data) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Resend service: Invalid event data was received"
      );
    }

    if (data.locale) {
      templateId =
        this.getLocalizedTemplateId(event, data.locale) || templateId;
    }

    const sendOptions: ResendOptions = {
      to: data.email,
      from: this.options_.from,
    };

    if (this.options_.subject_template_type === "text") {
      sendOptions.subject = fs.existsSync(
        path.join(this.templatePath_, templateId, "subject.txt")
      )
        ? fs.readFileSync(
            path.join(this.templatePath_, templateId, "subject.txt"),
            "utf8"
          )
        : null;
    } else {
      sendOptions.subject = await this.compileSubjectTemplate(templateId, data);
    }

    if (this.options_.body_template_type === "react") {
      const react = await this.compileReactTemplate(templateId, data);
      if (react) sendOptions.react = react;
    } else {
      const { html, text } = await this.compileBodyTemplate(templateId, data);
      if (html) sendOptions.html = html;
      if (text) sendOptions.text = text;
    }

    if (
      !sendOptions.subject ||
      (!sendOptions.html && !sendOptions.text && !sendOptions.react)
    ) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Resend service: The requested templates were not found. Check template path in config."
      );
    }

    const attachments = await this.fetchAttachments(
      event,
      data,
      attachmentGenerator
    );

    if (attachments?.length) {
      sendOptions.attachments = attachments.map((a) => {
        return {
          content: a.base64,
          filename: a.name,
        };
      });
    }

    let status;
    await this.transporter_.emails
      // @ts-ignore
      .send(sendOptions)
      .then(() => {
        status = "sent";
      })
      .catch((error) => {
        status = "failed";
        console.log(error);
      });

    // We don't want heavy docs stored in DB
    delete sendOptions.attachments;

    const recordOptions: Record<string, unknown> =
      sendOptions as unknown as Record<string, unknown>;
    return { to: data.email, status, data: recordOptions };
  }

  async resendNotification(
    notification,
    config,
    attachmentGenerator
  ): Promise<{
    to: string;
    status: string;
    data: Record<string, unknown>;
  }> {
    const sendOptions = {
      ...notification.data,
      to: config.to || notification.to,
    };

    const attachs = await this.fetchAttachments(
      notification.event_name,
      notification.data.dynamic_template_data,
      attachmentGenerator
    );

    sendOptions.attachments = attachs.map((a) => {
      return {
        content: a.base64,
        filename: a.name,
        encoding: "base64",
        contentType: a.type,
      };
    });

    let status;
    await this.transporter_.emails
      .send(sendOptions)
      .then(() => {
        status = "sent";
      })
      .catch((error) => {
        status = "failed";
        console.log(error);
      });

    return { to: sendOptions.to, status, data: sendOptions };
  }

  /**
   * Sends an email using Resend.
   * @param {string} template_id - id of template to use
   * @param {string} from - sender of email
   * @param {string} to - receiver of email
   * @param {Object} data - data to send in mail (match with template)
   * @return {Promise} result of the send operation
   */
  async sendEmail(templateId, from, to, data) {
    // This function is used by the /resend/send API endpoint included in this plugin.
    // It is disabled by default.
    // This endpoint may be useful for testing purposes and for use by related applications.
    // There is NO SECURITY on the endpoint by default.
    // Most people will NOT need to enable it.
    // If you are certain that you want to enable it and that you know what you are doing,
    // set the environment variable RESEND_ENABLE_ENDPOINT to "42" (a string, not an int).
    // The unsual setting is meant to prevent enabling by accident or without thought.
    if (this.options_.enable_endpoint !== "42") {
      return false;
    }

    const sendOptions: ResendOptions = {
      to: to,
      from: from,
    };

    if (this.options_.subject_template_type === "text") {
      sendOptions.subject = fs.existsSync(
        path.join(this.templatePath_, templateId, "subject.txt")
      )
        ? fs.readFileSync(
            path.join(this.templatePath_, templateId, "subject.txt"),
            "utf8"
          )
        : null;
    } else {
      sendOptions.subject = await this.compileSubjectTemplate(templateId, data);
    }

    if (this.options_.body_template_type === "react") {
      const react = await this.compileReactTemplate(templateId, data);
      if (react) sendOptions.react = react;
    } else {
      const { html, text } = await this.compileBodyTemplate(templateId, data);
      if (html) sendOptions.html = html;
      if (text) sendOptions.text = text;
    }

    if (
      !sendOptions.subject ||
      (!sendOptions.html && !sendOptions.text && !sendOptions.react)
    ) {
      return {
        message:
          "Message not sent. Templates were not found or a compile error was encountered.",
        results: {
          sendOptions,
        },
      };
    }

    let status;
    await this.transporter_.emails
      // @ts-ignore
      .send(sendOptions)
      .then(() => {
        status = "sent";
      })
      .catch((error) => {
        status = "failed";
        console.log(error);
      });

    return { to: sendOptions.to, status, data: sendOptions };
  }

  async compileSubjectTemplate(templateId, data) {
    const subjectTemplate = fs.existsSync(
      path.join(this.templatePath_, templateId, "subject.hbs")
    )
      ? Handlebars.compile(
          fs.readFileSync(
            path.join(this.templatePath_, templateId, "subject.hbs"),
            "utf8"
          )
        )
      : null;

    if (subjectTemplate) return subjectTemplate(data);
    else return null;
  }

  async compileBodyTemplate(templateId, data) {
    const htmlTemplate = fs.existsSync(
      path.join(this.templatePath_, templateId, "html.hbs")
    )
      ? Handlebars.compile(
          fs.readFileSync(
            path.join(this.templatePath_, templateId, "html.hbs"),
            "utf8"
          )
        )
      : null;

    const textTemplate = fs.existsSync(
      path.join(this.templatePath_, templateId, "text.hbs")
    )
      ? Handlebars.compile(
          fs.readFileSync(
            path.join(this.templatePath_, templateId, "text.hbs"),
            "utf8"
          )
        )
      : null;

    return {
      html: htmlTemplate ? htmlTemplate(data) : null,
      text: textTemplate ? textTemplate(data) : null,
    };
  }

  async compileReactTemplate(templateId, data) {
    if (fs.existsSync(path.join(this.templatePath_, templateId, "html.js"))) {
      let EmailTemplate = await import(
        path.join(this.templatePath_, templateId, "html.js")
      );
      return EmailTemplate.default(data);
    }
  }

  getLocalizedTemplateId(event, locale) {
    if (this.options_.localization && this.options_.localization[locale]) {
      const map = this.options_.localization[locale];
      switch (event) {
        case "order.return_requested":
          return map.order_return_requested_template;
        case "swap.shipment_created":
          return map.swap_shipment_created_template;
        case "claim.shipment_created":
          return map.claim_shipment_created_template;
        case "order.items_returned":
          return map.order_items_returned_template;
        case "swap.received":
          return map.swap_received_template;
        case "swap.created":
          return map.swap_created_template;
        case "gift_card.created":
          return map.gift_card_created_template;
        case "order.gift_card_created":
          return map.gift_card_created_template;
        case "order.placed":
          return map.order_placed_template;
        case "order.shipment_created":
          return map.order_shipped_template;
        case "order.canceled":
          return map.order_canceled_template;
        case "user.password_reset":
          return map.user_password_reset_template;
        case "customer.password_reset":
          return map.customer_password_reset_template;
        case "restock-notification.restocked":
          return map.medusa_restock_template;
        case "order.refund_created":
          return map.order_refund_created_template;
        default:
          return null;
      }
    }
    return null;
  }

  getTemplateId(event: string, subject = false) {
    const eventName = event.replace(/\./g, '_');
    const templateKey = `${eventName}_template`;
  
    if (this.options_[templateKey]) {
      return this.options_[templateKey];
    }
  
    return null;
  }

  async fetchAttachments(
    event: string,
    data: Record<any, any>,
    attachmentGenerator?: any
  ): Promise<Attachment[]> {
    switch (event) {
      case "swap.created":
      case "order.return_requested": {
        let attachments: Attachment[] = [];
        const { shipping_method, shipping_data } = data.return_request;
        if (shipping_method) {
          const provider = shipping_method.shipping_option.provider_id;

          const lbl = await this.fulfillmentProviderService_.retrieveDocuments(
            provider,
            shipping_data,
            "label"
          );

          attachments = attachments.concat(
            lbl.map((d) => ({
              name: "return-label",
              base64: d.base_64,
              type: d.type,
            }))
          );
        }

        if (attachmentGenerator && attachmentGenerator.createReturnInvoice) {
          const base64 = await attachmentGenerator.createReturnInvoice(
            data.order,
            data.return_request.items
          );
          attachments.push({
            name: "invoice",
            base64,
            type: "application/pdf",
          });
        }

        return attachments;
      }
      default:
        return [];
    }
  }

  async fetchData(
    event: string,
    eventData: EventData,
    attachmentGenerator: any
  ): Promise<Record<any, any>> {
    switch (event) {
      case "order.return_requested":
        return this.returnRequestedData(eventData);
      case "swap.shipment_created":
        return this.swapShipmentCreatedData(eventData);
      case "claim.shipment_created":
        return this.claimShipmentCreatedData(eventData);
      case "order.items_returned":
        return this.itemsReturnedData(eventData);
      case "swap.received":
        return this.swapReceivedData(eventData);
      case "swap.created":
        return this.swapCreatedData(eventData);
      case "gift_card.created":
        return this.gcCreatedData(eventData);
      case "order.gift_card_created":
        return this.gcCreatedData(eventData);
      case "order.placed":
        return this.orderPlacedData(eventData);
      case "order.shipment_created":
        return this.orderShipmentCreatedData(eventData);
      case "order.canceled":
        return this.orderCanceledData(eventData);
      case "user.password_reset":
        return this.userPasswordResetData(eventData);
      case "customer.password_reset":
        return this.customerPasswordResetData(eventData);
      case "restock-notification.restocked":
        return await this.restockNotificationData(eventData);
      case "order.refund_created":
        return this.orderRefundCreatedData(eventData);
      default:
        return {};
    }
  }

  async orderShipmentCreatedData({ id, fulfillment_id }: EventData) {
    if (!fulfillment_id) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Resend service: No fulfillment_id was set for event: order.shipment_created`
      );
    }
    const order = await this.orderService_.retrieve(id, {
      select: [
        "shipping_total",
        "discount_total",
        "tax_total",
        "refunded_total",
        "gift_card_total",
        "subtotal",
        "total",
        "refundable_amount",
      ],
      relations: [
        "customer",
        "billing_address",
        "shipping_address",
        "discounts",
        "discounts.rule",
        "shipping_methods",
        "shipping_methods.shipping_option",
        "payments",
        "fulfillments",
        "returns",
        "gift_cards",
        "gift_card_transactions",
      ],
    });

    const shipment = await this.fulfillmentService_.retrieve(fulfillment_id, {
      relations: ["items", "tracking_links"],
    });

    const locale = await this.extractLocale(order);

    return {
      locale,
      order,
      date: shipment.shipped_at.toDateString(),
      email: order.email,
      fulfillment: shipment,
      tracking_links: shipment.tracking_links,
      tracking_number: shipment.tracking_numbers.join(", "),
    };
  }

  async orderCanceledData({ id }: EventData) {
    const order = await this.orderService_.retrieve(id, {
      select: [
        "shipping_total",
        "discount_total",
        "tax_total",
        "refunded_total",
        "gift_card_total",
        "subtotal",
        "total",
      ],
      relations: [
        "customer",
        "billing_address",
        "shipping_address",
        "discounts",
        "discounts.rule",
        "shipping_methods",
        "shipping_methods.shipping_option",
        "payments",
        "fulfillments",
        "returns",
        "gift_cards",
        "gift_card_transactions",
      ],
    });

    const {
      subtotal,
      tax_total,
      discount_total,
      shipping_total,
      gift_card_total,
      total,
    } = order;

    const taxRate = (order?.tax_rate || 0) / 100;
    const currencyCode = order.currency_code.toUpperCase();

    const items = this.processItems_(order.items, taxRate, currencyCode);

    let discounts: {
      is_giftcard: boolean;
      code: string;
      descriptor: string;
    }[] = [];
    if (order.discounts) {
      discounts = order.discounts.map((discount) => {
        return {
          is_giftcard: false,
          code: discount.code,
          descriptor: `${discount.rule.value}${
            discount.rule.type === "percentage" ? "%" : ` ${currencyCode}`
          }`,
        };
      });
    }

    let giftCards: {
      is_giftcard: boolean;
      code: string;
      descriptor: string;
    }[] = [];
    if (order.gift_cards) {
      giftCards = order.gift_cards.map((gc) => {
        return {
          is_giftcard: true,
          code: gc.code,
          descriptor: `${gc.value} ${currencyCode}`,
        };
      });
      discounts.concat(giftCards);
    }

    const locale = await this.extractLocale(order);

    return {
      ...order,
      locale,
      has_discounts: order.discounts.length,
      has_gift_cards: order.gift_cards.length,
      date: order.created_at.toDateString(),
      items,
      discounts,
      subtotal: `${this.humanPrice_(
        subtotal * (1 + taxRate),
        currencyCode
      )} ${currencyCode}`,
      gift_card_total: `${this.humanPrice_(
        gift_card_total * (1 + taxRate),
        currencyCode
      )} ${currencyCode}`,
      tax_total: `${this.humanPrice_(tax_total, currencyCode)} ${currencyCode}`,
      discount_total: `${this.humanPrice_(
        discount_total * (1 + taxRate),
        currencyCode
      )} ${currencyCode}`,
      shipping_total: `${this.humanPrice_(
        shipping_total * (1 + taxRate),
        currencyCode
      )} ${currencyCode}`,
      total: `${this.humanPrice_(total, currencyCode)} ${currencyCode}`,
    };
  }

  async orderPlacedData({ id }: EventData) {
    const order = await this.orderService_.retrieve(id, {
      select: [
        "shipping_total",
        "discount_total",
        "tax_total",
        "refunded_total",
        "gift_card_total",
        "subtotal",
        "total",
      ],
      relations: [
        "customer",
        "billing_address",
        "shipping_address",
        "discounts",
        "discounts.rule",
        "shipping_methods",
        "shipping_methods.shipping_option",
        "payments",
        "fulfillments",
        "returns",
        "gift_cards",
        "gift_card_transactions",
      ],
    });

    const { tax_total, shipping_total, gift_card_total, total } = order;

    const currencyCode = order.currency_code.toUpperCase();
    const promises: Promise<any>[] = [];
    order.items.forEach((item) => {
      promises.push(
        this.totalsService_.getLineItemTotals(item, order, {
          include_tax: true,
          use_tax_lines: true,
        })
      );
    });
    const totals: any[] = await Promise.all(promises);
    const items: PricedLineItem[] = [];

    for (let i = 0; i < order.items.length; i++) {
      const item = order.items[i];

      items.push({
        ...item,
        totals: totals[i],
        thumbnail: this.normalizeThumbUrl_(item.thumbnail),
        discounted_price: `${this.humanPrice_(
          totals[i].total / item.quantity,
          currencyCode
        )} ${currencyCode}`,
        price: `${this.humanPrice_(
          totals[i].original_total / item.quantity,
          currencyCode
        )} ${currencyCode}`,
      });
    }

    let discounts: {
      is_giftcard: boolean;
      code: string;
      descriptor: string;
    }[] = [];
    if (order.discounts) {
      discounts = order.discounts.map((discount) => {
        return {
          is_giftcard: false,
          code: discount.code,
          descriptor: `${discount.rule.value}${
            discount.rule.type === "percentage" ? "%" : ` ${currencyCode}`
          }`,
        };
      });
    }

    let giftCards: {
      is_giftcard: boolean;
      code: string;
      descriptor: string;
    }[] = [];
    if (order.gift_cards) {
      giftCards = order.gift_cards.map((gc) => {
        return {
          is_giftcard: true,
          code: gc.code,
          descriptor: `${gc.value} ${currencyCode}`,
        };
      });

      discounts.concat(giftCards);
    }

    const locale = await this.extractLocale(order);

    // Includes taxes in discount amount
    const discountTotal = items.reduce((acc, i) => {
      return acc + i.totals.original_total - i.totals.total;
    }, 0);

    const discounted_subtotal = items.reduce((acc, i) => {
      return acc + i.totals.total;
    }, 0);
    const subtotal = items.reduce((acc, i) => {
      return acc + i.totals.original_total;
    }, 0);

    const subtotal_ex_tax = items.reduce((total, i) => {
      return total + i.totals.subtotal;
    }, 0);

    return {
      ...order,
      locale,
      has_discounts: order.discounts.length,
      has_gift_cards: order.gift_cards.length,
      date: order.created_at.toDateString(),
      items,
      discounts,
      subtotal_ex_tax: `${this.humanPrice_(
        subtotal_ex_tax,
        currencyCode
      )} ${currencyCode}`,
      subtotal: `${this.humanPrice_(subtotal, currencyCode)} ${currencyCode}`,
      gift_card_total: `${this.humanPrice_(
        gift_card_total,
        currencyCode
      )} ${currencyCode}`,
      tax_total: `${this.humanPrice_(tax_total, currencyCode)} ${currencyCode}`,
      discount_total: `${this.humanPrice_(
        discountTotal,
        currencyCode
      )} ${currencyCode}`,
      shipping_total: `${this.humanPrice_(
        shipping_total,
        currencyCode
      )} ${currencyCode}`,
      total: `${this.humanPrice_(total, currencyCode)} ${currencyCode}`,
    };
  }

  async gcCreatedData({ id }: EventData) {
    const giftCard = await this.giftCardService_.retrieve(id, {
      relations: ["region", "order"],
    });
    const taxRate = giftCard.region.tax_rate / 100;
    const locale = giftCard.order
      ? await this.extractLocale(giftCard.order)
      : null;
    const email = giftCard.order
      ? giftCard.order.email
      : giftCard.metadata.email;

    return {
      ...giftCard,
      locale,
      email,
      display_value: `${this.humanPrice_(
        giftCard.value * 1 + taxRate,
        giftCard.region.currency_code
      )} ${giftCard.region.currency_code}`,
      message:
        giftCard.metadata?.message || giftCard.metadata?.personal_message,
    };
  }

  async returnRequestedData({ id, return_id }: EventData) {
    if (!return_id) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Resend service: No return_id was set for event: order.return_requested`
      );
    }
    // Fetch the return request
    const returnRequest = await this.returnService_.retrieve(return_id, {
      relations: [
        "items",
        "items.item",
        "items.item.tax_lines",
        "items.item.variant",
        "items.item.variant.product",
        "shipping_method",
        "shipping_method.tax_lines",
        "shipping_method.shipping_option",
      ],
    });

    const items = await this.lineItemService_.list(
      {
        id: returnRequest.items.map(({ item_id }) => item_id),
      },
      {
        relations: ["tax_lines"],
      }
    );

    // Fetch the order
    const order = await this.orderService_.retrieve(id, {
      select: ["total"],
      relations: [
        "items",
        "items.tax_lines",
        "discounts",
        "discounts.rule",
        "shipping_address",
        "returns",
      ],
    });

    const currencyCode = order.currency_code.toUpperCase();

    const promises: Promise<any>[] = [];
    returnRequest.items.forEach((item) => {
      const found = items.find((oi) => oi.id === item.item_id);
      if (!found) {
        return promises.push(
          new Promise((resolve) =>
            resolve({
              total: 0,
              tax_lines: [],
              unit_price: 0,
              subtotal: 0,
              tax_total: 0,
              discount_total: 0,
              quantity: 0,
              original_total: 0,
              original_tax_total: 0,
              raw_discount_total: 0,
            })
          )
        );
      }
      return promises.push(
        this.totalsService_.getLineItemTotals(found, order, {
          include_tax: true,
          use_tax_lines: true,
        })
      );
    });
    const totals: any[] = await Promise.all(promises);

    const returnItems: PricedReturnItem[] = [];
    // Calculate which items are in the return
    for (let i = 0; i < returnRequest.items.length; i++) {
      const item = returnRequest.items[i];
      const found = items.find((oi) => oi.id === item.item_id);
      if (!found) {
        continue;
      }
      returnItems.push({
        ...item,
        totals: totals[i],
        price: `${this.humanPrice_(
          totals[i].total / item.quantity,
          currencyCode
        )} ${currencyCode}`,
        tax_lines: found.tax_lines,
        thumbnail: this.normalizeThumbUrl_(found.thumbnail),
      });
    }

    // Get total of the returned products
    const item_subtotal = returnItems.reduce(
      (acc, next) => acc + next.totals.total,
      0
    );

    // If the return has a shipping method get the price and any attachments
    let shippingTotal = 0;
    if (returnRequest.shipping_method) {
      const base = returnRequest.shipping_method.price;
      shippingTotal =
        base +
        returnRequest.shipping_method.tax_lines.reduce((acc, next) => {
          return Math.round(acc + base * (next.rate / 100));
        }, 0);
    }

    const locale = await this.extractLocale(order);

    return {
      locale,
      has_shipping: !!returnRequest.shipping_method,
      email: order.email,
      items: returnItems,
      subtotal: `${this.humanPrice_(
        item_subtotal,
        currencyCode
      )} ${currencyCode}`,
      shipping_total: `${this.humanPrice_(
        shippingTotal,
        currencyCode
      )} ${currencyCode}`,
      refund_amount: `${this.humanPrice_(
        returnRequest.refund_amount,
        currencyCode
      )} ${currencyCode}`,
      return_request: {
        ...returnRequest,
        refund_amount: `${this.humanPrice_(
          returnRequest.refund_amount,
          currencyCode
        )} ${currencyCode}`,
      },
      order,
      date: returnRequest.updated_at.toDateString(),
    };
  }

  async swapReceivedData({ id }: EventData) {
    const store = await this.storeService_.retrieve();
    const swap = await this.swapService_.retrieve(id, {
      relations: [
        "additional_items",
        "additional_items.tax_lines",
        "return_order",
        "return_order.items",
        "return_order.items.item",
        "return_order.shipping_method",
        "return_order.shipping_method.shipping_option",
      ],
    });

    const returnRequest = swap.return_order;

    const items = await this.lineItemService_.list(
      {
        id: returnRequest.items.map(({ item_id }) => item_id),
      },
      {
        relations: ["tax_lines"],
      }
    );

    returnRequest.items = returnRequest.items.map((item) => {
      const found = items.find((i) => i.id === item.item_id);
      if (!found) {
        return item;
      }
      return {
        ...item,
        item: found,
      };
    });

    const swapLink = store?.swap_link_template?.replace(
      /\{cart_id\}/,
      swap.cart_id
    );

    const order = await this.orderService_.retrieve(swap.order_id, {
      select: ["total"],
      relations: [
        "items",
        "discounts",
        "discounts.rule",
        "shipping_address",
        "swaps",
        "swaps.additional_items",
        "swaps.additional_items.tax_lines",
      ],
    });

    const cart = await this.cartService_.retrieve(swap.cart_id, {
      select: [
        "total",
        "tax_total",
        "discount_total",
        "shipping_total",
        "subtotal",
      ],
    });
    const currencyCode = order.currency_code.toUpperCase();

    const decoratedItems = await Promise.all(
      cart.items.map(async (i) => {
        const totals = await this.totalsService_.getLineItemTotals(i, cart, {
          include_tax: true,
        });

        return {
          ...i,
          totals,
          price: this.humanPrice_(
            totals.subtotal + totals.tax_total,
            currencyCode
          ),
        };
      })
    );

    const returnTotal = decoratedItems.reduce((acc, next) => {
      if (next.is_return) {
        return acc + -1 * (next.totals.subtotal + next.totals.tax_total);
      }
      return acc;
    }, 0);

    const additionalTotal = decoratedItems.reduce((acc, next) => {
      if (!next.is_return) {
        return acc + next.totals.subtotal + next.totals.tax_total;
      }
      return acc;
    }, 0);

    const refundAmount = swap.return_order.refund_amount;

    const locale = await this.extractLocale(order);

    return {
      locale,
      swap,
      order,
      return_request: returnRequest,
      date: swap.updated_at.toDateString(),
      swap_link: swapLink,
      email: order.email,
      items: decoratedItems.filter((di) => !di.is_return),
      return_items: decoratedItems.filter((di) => di.is_return),
      return_total: `${this.humanPrice_(
        returnTotal,
        currencyCode
      )} ${currencyCode}`,
      tax_total: `${this.humanPrice_(
        cart.total,
        currencyCode
      )} ${currencyCode}`,
      refund_amount: `${this.humanPrice_(
        refundAmount,
        currencyCode
      )} ${currencyCode}`,
      additional_total: `${this.humanPrice_(
        additionalTotal,
        currencyCode
      )} ${currencyCode}`,
    };
  }

  async swapCreatedData({ id }: EventData) {
    const store = await this.storeService_.retrieve();
    const swap = await this.swapService_.retrieve(id, {
      relations: [
        "additional_items",
        "additional_items.tax_lines",
        "return_order",
        "return_order.items",
        "return_order.items.item",
        "return_order.shipping_method",
        "return_order.shipping_method.shipping_option",
      ],
    });

    const returnRequest = swap.return_order;

    const items = await this.lineItemService_.list(
      {
        id: returnRequest.items.map(({ item_id }) => item_id),
      },
      {
        relations: ["tax_lines"],
      }
    );

    returnRequest.items = returnRequest.items.map((item) => {
      const found = items.find((i) => i.id === item.item_id);
      if (!found) {
        return item;
      }
      return {
        ...item,
        item: found,
      };
    });

    const swapLink = store?.swap_link_template?.replace(
      /\{cart_id\}/,
      swap.cart_id
    );

    const order = await this.orderService_.retrieve(swap.order_id, {
      select: ["total"],
      relations: [
        "items",
        "items.tax_lines",
        "discounts",
        "discounts.rule",
        "shipping_address",
        "swaps",
        "swaps.additional_items",
        "swaps.additional_items.tax_lines",
      ],
    });

    const cart = await this.cartService_.retrieve(swap.cart_id, {
      select: [
        "total",
        "tax_total",
        "discount_total",
        "shipping_total",
        "subtotal",
      ],
    });
    const currencyCode = order.currency_code.toUpperCase();

    const decoratedItems = await Promise.all(
      cart.items.map(async (i) => {
        const totals = await this.totalsService_.getLineItemTotals(i, cart, {
          include_tax: true,
        });

        return {
          ...i,
          totals,
          tax_lines: totals.tax_lines,
          price: `${this.humanPrice_(
            totals.original_total / i.quantity,
            currencyCode
          )} ${currencyCode}`,
          discounted_price: `${this.humanPrice_(
            totals.total / i.quantity,
            currencyCode
          )} ${currencyCode}`,
        };
      })
    );

    const returnTotal = decoratedItems.reduce((acc, next) => {
      const { total } = next.totals;
      if (next.is_return && next.variant_id) {
        return acc + -1 * total;
      }
      return acc;
    }, 0);

    const additionalTotal = decoratedItems.reduce((acc, next) => {
      const { total } = next.totals;
      if (!next.is_return) {
        return acc + total;
      }
      return acc;
    }, 0);

    const refundAmount = swap.return_order.refund_amount;

    const locale = await this.extractLocale(order);

    return {
      locale,
      swap,
      order,
      return_request: returnRequest,
      date: swap.updated_at.toDateString(),
      swap_link: swapLink,
      email: order.email,
      items: decoratedItems.filter((di) => !di.is_return),
      return_items: decoratedItems.filter((di) => di.is_return),
      return_total: `${this.humanPrice_(
        returnTotal,
        currencyCode
      )} ${currencyCode}`,
      refund_amount: `${this.humanPrice_(
        refundAmount,
        currencyCode
      )} ${currencyCode}`,
      additional_total: `${this.humanPrice_(
        additionalTotal,
        currencyCode
      )} ${currencyCode}`,
    };
  }

  async itemsReturnedData(data: EventData) {
    return this.returnRequestedData(data);
  }

  async swapShipmentCreatedData({ id, fulfillment_id }: EventData) {
    if (!fulfillment_id) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Sendgrid service: No fulfillment_id was set for event: swap.shipment_created`
      );
    }
    const swap = await this.swapService_.retrieve(id, {
      relations: [
        "shipping_address",
        "shipping_methods",
        "shipping_methods.tax_lines",
        "additional_items",
        "additional_items.tax_lines",
        "return_order",
        "return_order.items",
      ],
    });

    const order = await this.orderService_.retrieve(swap.order_id, {
      relations: [
        "region",
        "items",
        "items.tax_lines",
        "discounts",
        "discounts.rule",
        "swaps",
        "swaps.additional_items",
        "swaps.additional_items.tax_lines",
      ],
    });

    const cart = await this.cartService_.retrieve(swap.cart_id, {
      select: [
        "total",
        "tax_total",
        "discount_total",
        "shipping_total",
        "subtotal",
      ],
    });

    const returnRequest = swap.return_order;
    const items = await this.lineItemService_.list(
      {
        id: returnRequest.items.map(({ item_id }) => item_id),
      },
      {
        relations: ["tax_lines"],
      }
    );

    const taxRate = (order.tax_rate || 0) / 100;
    const currencyCode = order.currency_code.toUpperCase();

    const returnItems = await Promise.all(
      swap.return_order.items.map(async (i) => {
        const found = items.find((oi) => oi.id === i.item_id);
        const totals = await this.totalsService_.getLineItemTotals(
          i.item,
          cart,
          {
            include_tax: true,
          }
        );

        return {
          ...found,
          thumbnail: this.normalizeThumbUrl_(found?.thumbnail),
          price: `${this.humanPrice_(
            totals.original_total / i.quantity,
            currencyCode
          )} ${currencyCode}`,
          discounted_price: `${this.humanPrice_(
            totals.total / i.quantity,
            currencyCode
          )} ${currencyCode}`,
          quantity: i.quantity,
        };
      })
    );

    const returnTotal = await this.totalsService_.getRefundTotal(
      order,
      // @ts-expect-error - wrong types in
      returnItems
    );

    const constructedOrder = {
      ...order,
      shipping_methods: swap.shipping_methods,
      items: swap.additional_items,
    };

    const additionalTotal = await this.totalsService_.getTotal(
      // @ts-expect-error - wrong types in
      constructedOrder
    );

    const refundAmount = swap.return_order.refund_amount;
    const shipment = await this.fulfillmentService_.retrieve(fulfillment_id, {
      relations: ["tracking_links"],
    });

    const locale = await this.extractLocale(order);

    return {
      locale,
      swap,
      order,
      items: await Promise.all(
        swap.additional_items.map(async (i) => {
          const totals = await this.totalsService_.getLineItemTotals(i, cart, {
            include_tax: true,
          });

          return {
            ...i,
            thumbnail: this.normalizeThumbUrl_(i.thumbnail),
            price: `${this.humanPrice_(
              totals.original_total / i.quantity,
              currencyCode
            )} ${currencyCode}`,
            discounted_price: `${this.humanPrice_(
              totals.total / i.quantity,
              currencyCode
            )} ${currencyCode}`,
            quantity: i.quantity,
          };
        })
      ),
      date: swap.updated_at.toDateString(),
      email: order.email,
      tax_amount: `${this.humanPrice_(
        cart.tax_total,
        currencyCode
      )} ${currencyCode}`,
      paid_total: `${this.humanPrice_(
        swap.difference_due,
        currencyCode
      )} ${currencyCode}`,
      return_total: `${this.humanPrice_(
        returnTotal,
        currencyCode
      )} ${currencyCode}`,
      refund_amount: `${this.humanPrice_(
        refundAmount,
        currencyCode
      )} ${currencyCode}`,
      additional_total: `${this.humanPrice_(
        additionalTotal,
        currencyCode
      )} ${currencyCode}`,
      fulfillment: shipment,
      tracking_links: shipment.tracking_links,
      tracking_number: shipment.tracking_numbers.join(", "),
    };
  }

  async claimShipmentCreatedData({ id, fulfillment_id }: EventData) {
    if (!fulfillment_id) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Resend service: No fulfillment_id was set for event: claim.shipment_created`
      );
    }

    const claim = await this.claimService_.retrieve(id, {
      relations: ["order", "order.items", "order.shipping_address"],
    });

    const shipment = await this.fulfillmentService_.retrieve(fulfillment_id, {
      relations: ["tracking_links"],
    });

    const locale = await this.extractLocale(claim.order);

    return {
      locale,
      email: claim.order.email,
      claim,
      order: claim.order,
      fulfillment: shipment,
      tracking_links: shipment.tracking_links,
      tracking_number: shipment.tracking_numbers.join(", "),
    };
  }

  async restockNotificationData({ variant_id, emails }: EventData) {
    if (!variant_id) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Resend service: No variant_id was set for event: restock-notification.restocked`
      );
    }
    const variant = await this.productVariantService_.retrieve(variant_id, {
      relations: ["product"],
    });

    let thumb;
    if (variant.product.thumbnail) {
      thumb = this.normalizeThumbUrl_(variant.product.thumbnail);
    }

    return {
      product: {
        ...variant.product,
        thumbnail: thumb,
      },
      variant,
      variant_id,
      emails,
    };
  }

  userPasswordResetData(data: EventData) {
    return data;
  }

  customerPasswordResetData(data: EventData) {
    return data;
  }

  async orderRefundCreatedData({ id, refund_id }: EventData) {
    const order = await this.orderService_.retrieveWithTotals(id, {
      select: ["total"],
      relations: ["refunds", "items"],
    });

    const refund = order.refunds.find((refund) => refund.id === refund_id);

    return {
      order,
      refund,
      refund_amount: `${this.humanPrice_(
        refund?.amount,
        order.currency_code
      )} ${order.currency_code}`,
      email: order.email,
    };
  }

  processItems_(items: LineItem[], taxRate: number, currencyCode: string) {
    return items.map((i) => {
      return {
        ...i,
        thumbnail: this.normalizeThumbUrl_(i.thumbnail),
        price: `${this.humanPrice_(
          i.unit_price * (1 + taxRate),
          currencyCode
        )} ${currencyCode}`,
      };
    });
  }

  humanPrice_(amount: number | null | undefined, currency: string) {
    if (!amount) {
      return "0.00";
    }

    const normalized = humanizeAmount(amount, currency);
    return normalized.toFixed(
      zeroDecimalCurrencies.includes(currency.toLowerCase()) ? 0 : 2
    );
  }

  normalizeThumbUrl_(url?: string | null) {
    if (!url) {
      return null;
    }

    if (url.startsWith("http")) {
      return url;
    } else if (url.startsWith("//")) {
      return `https:${url}`;
    }
    return url;
  }

  async extractLocale(fromOrder: Order) {
    if (fromOrder.cart_id) {
      try {
        const cart = await this.cartService_.retrieve(fromOrder.cart_id, {
          select: ["id", "context"],
        });

        if (cart.context && cart.context.locale) {
          return cart.context.locale;
        }
      } catch (err) {
        console.log(err);
        console.warn("Failed to gather context for order");
        return null;
      }
    }
    return null;
  }
}

export default ResendService;
