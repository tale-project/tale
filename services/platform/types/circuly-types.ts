export interface Address {
  first_name: string;
  last_name: string;
  company: string;
  street: string;
  postal_code: string;
  city: string;
  country: string;
  note: string;
}

export interface CustomerAddresses {
  billing: Address;
  shipping: Address;
}

export interface Customer {
  id: string;
  email: string;
  phone: string;
  external_customer_id: string;
  default_locale: string;
  date_of_birth: string;
  address: CustomerAddresses;
  created_at: string;
  updated_at: string;
}

export interface Item {
  id: string;
  order_id: string;
  product_id: string;
  sku: string;
  name: string;
  thumbnail: string;
  voucher_code: string | null;
  quantity: number;
  price: number;
  discount_amount: number;
  base_price: number;
  base_price_incl_tax: number;
  row_total: number;
  row_total_incl_tax: number;
  row_total_incl_discount: number;
  tax_amount: number;
  tax_percent: number;
  subscription: boolean;
  subscription_active: boolean;
  external_id: string;
  subscription_frequency: string;
  subscription_start: string;
  subscription_end: string;
  subscription_duration: number;
  subscription_duration_prepaid: number;
  original_price: number;
  expected_revenue: number;
  replace_external_id: string;
  replaced_by_external_id: string | null;
  replaced_by_order_item_id: string | null;
  company_id: string;
  created_at: string;
  updated_at: string;
}

export interface Notifications {
  customerNoReturn: boolean;
  startSubscription: boolean;
  subscriptionEnded: boolean;
  subscriptionEnding: boolean;
  customerNoReturnReminder: boolean;
}

export interface MetaData {
  notifications: Notifications;
}

export interface CirculySubscription {
  id: string;
  order_id: string;
  product_id: string;
  customer_id: string;
  customer: Customer;
  serial_number: string;
  item: Item | null;
  bundle_id: string | null;
  status: string;
  subscription_duration: number;
  subscription_frequency: string;
  subscription_start: string;
  subscription_end: string;
  subscription_price: number;
  next_billing_date: string;
  auto_renew: boolean;
  real_end_date: string;
  meta_data: MetaData;
  created_at: string;
  updated_at: string;
}

export interface CirculyProductVariant {
  id: number;
  product_id: number;
  shop_variant_id: string;
  sku: string;
  title: string;
  condition: null | string;
  subscription_item: boolean;
  frequency: string;
  duration: null | string;
  price: string;
  prepaid_duration: number;
  created_at: string;
  updated_at: string;
  options: Record<string, unknown>[];
  thumbnail: string;
  company_id: string;
  notify_period_before_end: null | string;
  bundle_id: string;
  subscription_extension_price: null | string;
  stock: number;
  active: boolean;
}

export interface CirculyProduct {
  id: number;
  buyout_retail_price: string;
  created_at: string;
  active: boolean;
  meta: Record<string, unknown>;
  msrp: string;
  picture_url: string;
  purchase_price: string;
  shop_id: string;
  sku: string;
  variants: CirculyProductVariant[];
  variant_amount: number;
  stock: number;
  sync_stock: boolean;
  product_collection_id: null | number;
  product_collection_title: null | string;
  title: string;
}
export interface CirculyApiResponse<T> {
  is_paginated: boolean;
  filterable: string[];
  data: T[];
  links: {
    first: string;
    last: string;
    prev: null | string;
    next: null | string;
  };
  meta: {
    current_page: number;
    from: number;
    last_page: number;
    path: string;
    per_page: number;
    to: number;
    total: number;
    links: Array<{
      url: string;
      label: string;
      active: boolean;
    }>;
  };
}
