/**
 * Shopify API Types for Products, Orders, Customers, and Webhooks
 */

// =============================================================================
// SHOPIFY PRODUCT TYPES
// =============================================================================

// Shopify product variant
export interface ShopifyProductVariant {
  id: number;
  product_id: number;
  title: string;
  price: string;
  sku?: string;
  position: number;
  inventory_policy: string;
  compare_at_price?: string;
  fulfillment_service: string;
  inventory_management?: string;
  option1?: string;
  option2?: string;
  option3?: string;
  created_at: string;
  updated_at: string;
  taxable: boolean;
  barcode?: string;
  grams: number;
  image_id?: number;
  weight: number;
  weight_unit: string;
  inventory_item_id: number;
  inventory_quantity: number;
  old_inventory_quantity: number;
  requires_shipping: boolean;
}

// Shopify product image
export interface ShopifyProductImage {
  id: number;
  product_id: number;
  position: number;
  created_at: string;
  updated_at: string;
  alt?: string;
  width: number;
  height: number;
  src: string;
  variant_ids: number[];
}

// Shopify product option
export interface ShopifyProductOption {
  id: number;
  product_id: number;
  name: string;
  position: number;
  values: string[];
}

// Shopify product
export interface ShopifyProduct {
  id: number;
  title: string;
  body_html?: string;
  vendor: string;
  product_type: string;
  created_at: string;
  handle: string;
  updated_at: string;
  published_at?: string;
  template_suffix?: string;
  status: string;
  published_scope: string;
  tags: string;
  admin_graphql_api_id: string;
  variants: ShopifyProductVariant[];
  options: ShopifyProductOption[];
  images: ShopifyProductImage[];
  image?: ShopifyProductImage;
}

// Shopify products API response
export interface ShopifyProductsResponse {
  products: ShopifyProduct[];
}

// =============================================================================
// SHOPIFY CUSTOMER TYPES
// =============================================================================

// Enhanced Shopify customer data
export interface ShopifyCustomer {
  id: number;
  email: string;
  accepts_marketing: boolean;
  created_at: string;
  updated_at: string;
  first_name?: string;
  last_name?: string;
  orders_count: number;
  state: string;
  total_spent: string;
  last_order_id?: number;
  note?: string;
  verified_email: boolean;
  multipass_identifier?: string;
  tax_exempt: boolean;
  phone?: string;
  tags: string;
  last_order_name?: string;
  currency: string;
  addresses: ShopifyCustomerAddress[];
  default_address?: ShopifyCustomerAddress;
}

// Shopify customer address
export interface ShopifyCustomerAddress {
  id?: number;
  customer_id?: number;
  first_name?: string;
  last_name?: string;
  company?: string;
  address1?: string;
  address2?: string;
  city?: string;
  province?: string;
  country?: string;
  zip?: string;
  phone?: string;
  name?: string;
  province_code?: string;
  country_code?: string;
  country_name?: string;
  default?: boolean;
}

// Shopify customers API response
export interface ShopifyCustomersResponse {
  customers: ShopifyCustomer[];
}

// =============================================================================
// SHOPIFY ORDER TYPES
// =============================================================================

// Shopify order line item
export interface ShopifyOrderLineItem {
  id: number;
  variant_id?: number;
  title: string;
  quantity: number;
  sku?: string;
  variant_title?: string;
  vendor?: string;
  fulfillment_service: string;
  product_id?: number;
  requires_shipping: boolean;
  taxable: boolean;
  gift_card: boolean;
  name: string;
  variant_inventory_management?: string;
  properties: Array<{
    name: string;
    value: string;
  }>;
  product_exists: boolean;
  fulfillable_quantity: number;
  grams: number;
  price: string;
  total_discount: string;
  fulfillment_status?: string;
  price_set: {
    shop_money: {
      amount: string;
      currency_code: string;
    };
    presentment_money: {
      amount: string;
      currency_code: string;
    };
  };
  total_discount_set: {
    shop_money: {
      amount: string;
      currency_code: string;
    };
    presentment_money: {
      amount: string;
      currency_code: string;
    };
  };
  discount_allocations: Array<{
    amount: string;
    discount_application_index: number;
    amount_set: {
      shop_money: {
        amount: string;
        currency_code: string;
      };
      presentment_money: {
        amount: string;
        currency_code: string;
      };
    };
  }>;
  duties: unknown[];
  admin_graphql_api_id: string;
  tax_lines: Array<{
    channel_liable: boolean;
    price: string;
    price_set: {
      shop_money: {
        amount: string;
        currency_code: string;
      };
      presentment_money: {
        amount: string;
        currency_code: string;
      };
    };
    rate: number;
    title: string;
  }>;
}

// Shopify order shipping address
export interface ShopifyOrderAddress {
  first_name?: string;
  address1?: string;
  phone?: string;
  city?: string;
  zip?: string;
  province?: string;
  country?: string;
  last_name?: string;
  address2?: string;
  company?: string;
  latitude?: number;
  longitude?: number;
  name?: string;
  country_code?: string;
  province_code?: string;
}

// Shopify order discount code
export interface ShopifyOrderDiscountCode {
  code: string;
  amount: string;
  type: string;
}

// Shopify order shipping line
export interface ShopifyOrderShippingLine {
  id: number;
  carrier_identifier?: string;
  code?: string;
  delivery_category?: string;
  discount_allocations: unknown[];
  discounted_price: string;
  discounted_price_set: {
    shop_money: {
      amount: string;
      currency_code: string;
    };
    presentment_money: {
      amount: string;
      currency_code: string;
    };
  };
  phone?: string;
  price: string;
  price_set: {
    shop_money: {
      amount: string;
      currency_code: string;
    };
    presentment_money: {
      amount: string;
      currency_code: string;
    };
  };
  requested_fulfillment_service_id?: string;
  source: string;
  title: string;
  tax_lines: unknown[];
  custom: boolean;
}

// Shopify order
export interface ShopifyOrder {
  id: number;
  admin_graphql_api_id: string;
  app_id?: number;
  browser_ip?: string;
  buyer_accepts_marketing: boolean;
  cancel_reason?: string;
  cancelled_at?: string;
  cart_token?: string;
  checkout_id?: number;
  checkout_token?: string;
  client_details?: {
    accept_language?: string;
    browser_height?: number;
    browser_ip?: string;
    browser_width?: number;
    session_hash?: string;
    user_agent?: string;
  };
  closed_at?: string;
  confirmed: boolean;
  contact_email?: string;
  created_at: string;
  currency: string;
  current_subtotal_price: string;
  current_subtotal_price_set: {
    shop_money: {
      amount: string;
      currency_code: string;
    };
    presentment_money: {
      amount: string;
      currency_code: string;
    };
  };
  current_total_discounts: string;
  current_total_discounts_set: {
    shop_money: {
      amount: string;
      currency_code: string;
    };
    presentment_money: {
      amount: string;
      currency_code: string;
    };
  };
  current_total_duties_set?: unknown;
  current_total_price: string;
  current_total_price_set: {
    shop_money: {
      amount: string;
      currency_code: string;
    };
    presentment_money: {
      amount: string;
      currency_code: string;
    };
  };
  current_total_tax: string;
  current_total_tax_set: {
    shop_money: {
      amount: string;
      currency_code: string;
    };
    presentment_money: {
      amount: string;
      currency_code: string;
    };
  };
  customer_locale?: string;
  device_id?: string;
  discount_codes: ShopifyOrderDiscountCode[];
  email?: string;
  estimated_taxes: boolean;
  financial_status: string;
  fulfillment_status?: string;
  gateway?: string;
  landing_site?: string;
  landing_site_ref?: string;
  location_id?: number;
  name: string;
  note?: string;
  note_attributes: Array<{
    name: string;
    value: string;
  }>;
  number: number;
  order_number: number;
  order_status_url: string;
  original_total_duties_set?: unknown;
  payment_gateway_names: string[];
  phone?: string;
  presentment_currency: string;
  processed_at: string;
  processing_method: string;
  reference?: string;
  referring_site?: string;
  source_identifier?: string;
  source_name?: string;
  source_url?: string;
  subtotal_price: string;
  subtotal_price_set: {
    shop_money: {
      amount: string;
      currency_code: string;
    };
    presentment_money: {
      amount: string;
      currency_code: string;
    };
  };
  tags: string;
  tax_lines: Array<{
    price: string;
    rate: number;
    title: string;
    price_set: {
      shop_money: {
        amount: string;
        currency_code: string;
      };
      presentment_money: {
        amount: string;
        currency_code: string;
      };
    };
    channel_liable: boolean;
  }>;
  taxes_included: boolean;
  test: boolean;
  token: string;
  total_discounts: string;
  total_discounts_set: {
    shop_money: {
      amount: string;
      currency_code: string;
    };
    presentment_money: {
      amount: string;
      currency_code: string;
    };
  };
  total_line_items_price: string;
  total_line_items_price_set: {
    shop_money: {
      amount: string;
      currency_code: string;
    };
    presentment_money: {
      amount: string;
      currency_code: string;
    };
  };
  total_outstanding: string;
  total_price: string;
  total_price_set: {
    shop_money: {
      amount: string;
      currency_code: string;
    };
    presentment_money: {
      amount: string;
      currency_code: string;
    };
  };
  total_price_usd: string;
  total_shipping_price_set: {
    shop_money: {
      amount: string;
      currency_code: string;
    };
    presentment_money: {
      amount: string;
      currency_code: string;
    };
  };
  total_tax: string;
  total_tax_set: {
    shop_money: {
      amount: string;
      currency_code: string;
    };
    presentment_money: {
      amount: string;
      currency_code: string;
    };
  };
  total_tip_received: string;
  total_weight: number;
  updated_at: string;
  user_id?: number;
  billing_address?: ShopifyOrderAddress;
  customer?: ShopifyCustomer;
  discount_applications: unknown[];
  fulfillments: unknown[];
  line_items: ShopifyOrderLineItem[];
  payment_terms?: unknown;
  refunds: unknown[];
  shipping_address?: ShopifyOrderAddress;
  shipping_lines: ShopifyOrderShippingLine[];
}

// Shopify orders API response
export interface ShopifyOrdersResponse {
  orders: ShopifyOrder[];
}

// Shopify line item from abandoned checkout (legacy)
export interface ShopifyLineItem {
  id: number;
  product_id: number;
  variant_id: number;
  title: string;
  quantity: number;
  price: string;
  grams: number;
  sku?: string;
  variant_title?: string;
  vendor?: string;
  product_handle?: string;
  properties?: Array<{
    name: string;
    value: string;
  }>;
}

// Shopify abandoned checkout data
export interface ShopifyAbandonedCheckout {
  id: number;
  token: string;
  email?: string;
  abandoned_checkout_url: string;
  created_at: string;
  updated_at: string;
  completed_at?: string;
  currency: string;
  total_price: string;
  subtotal_price: string;
  total_tax: string;
  line_items: ShopifyLineItem[];
  customer?: ShopifyCustomer;
  billing_address?: {
    first_name?: string;
    last_name?: string;
    company?: string;
    address1?: string;
    address2?: string;
    city?: string;
    province?: string;
    country?: string;
    zip?: string;
    phone?: string;
  };
  shipping_address?: {
    first_name?: string;
    last_name?: string;
    company?: string;
    address1?: string;
    address2?: string;
    city?: string;
    province?: string;
    country?: string;
    zip?: string;
    phone?: string;
  };
}

// Shopify API response for abandoned checkouts
export interface ShopifyAbandonedCheckoutsResponse {
  checkouts: ShopifyAbandonedCheckout[];
}

// =============================================================================
// DATABASE TYPE MAPPINGS
// =============================================================================

// Use extended Customer type for processed potential customers
import { Doc, Id } from '../convex/_generated/dataModel';

export type ProcessedPotentialCustomer = {
  organizationId: string;
  email: string;
  name?: string;
  phone?: string;
  metadata?: unknown;
};

// Database types for Shopify entities (using Convex types)
export type DatabaseProduct = Doc<'products'>;
export type DatabaseProductInsert = Omit<
  Doc<'products'>,
  '_id' | '_creationTime'
>;
export type DatabaseProductUpdate = Partial<DatabaseProductInsert>;

export type DatabaseCustomer = Doc<'customers'>;
export type DatabaseCustomerInsert = Omit<
  Doc<'customers'>,
  '_id' | '_creationTime'
>;
export type DatabaseCustomerUpdate = Partial<DatabaseCustomerInsert>;

export type DatabaseOrder = {
  _id: string;
  _creationTime: number;
  organizationId: string;
  customerId: Id<'customers'>;
  externalOrderId?: string;
  status: string;
  totalAmount: number;
  currency: string;
  metadata?: unknown;
};
export type DatabaseOrderInsert = Omit<DatabaseOrder, '_id' | '_creationTime'>;
export type DatabaseOrderUpdate = Partial<DatabaseOrderInsert>;

// =============================================================================
// WEBHOOK TYPES
// =============================================================================

// Shopify webhook payload for products
export interface ShopifyProductWebhookPayload {
  id: number;
  title: string;
  body_html?: string;
  vendor: string;
  product_type: string;
  created_at: string;
  handle: string;
  updated_at: string;
  published_at?: string;
  template_suffix?: string;
  status: string;
  published_scope: string;
  tags: string;
  admin_graphql_api_id: string;
  variants: ShopifyProductVariant[];
  options: ShopifyProductOption[];
  images: ShopifyProductImage[];
  image?: ShopifyProductImage;
}

// Shopify webhook payload for customers
export type ShopifyCustomerWebhookPayload = ShopifyCustomer;

// Shopify webhook payload for orders
export type ShopifyOrderWebhookPayload = ShopifyOrder;

// =============================================================================
// SYNC RESULT INTERFACES
// =============================================================================

// Generic sync result interface
export interface ShopifySyncResult {
  success: boolean;
  processed_count: number;
  created_count: number;
  updated_count: number;
  skipped_count: number;
  errors: string[];
  last_sync_at: string;
}

// Product sync result
export type ShopifyProductSyncResult = ShopifySyncResult;

// Customer sync result
export type ShopifyCustomerSyncResult = ShopifySyncResult;

// Order sync result
export type ShopifyOrderSyncResult = ShopifySyncResult;

// Abandoned checkout sync result (legacy)
export interface ShopifyAbandonedCheckoutSyncResult {
  success: boolean;
  processed_count: number;
  created_count: number;
  skipped_count: number;
  errors: string[];
  last_sync_at: string;
}
